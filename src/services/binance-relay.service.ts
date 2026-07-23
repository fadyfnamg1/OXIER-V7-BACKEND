import WebSocket from "ws";
import { logger } from "../lib/logger";

/* ════════════════════════════════════════════════════════════
   BINANCE WS RELAY

   Replaces the frontend's direct browser connections to
   wss://stream.binance.com. Instead, this server keeps ONE upstream
   Binance socket per distinct stream (e.g. "btcusdt@kline_1m") no
   matter how many users are watching it, and fans the messages out
   to every subscribed client over our own /ws endpoint.

   Benefits over "every browser dials Binance directly":
   - Geo-blocking / connectivity issues only need to be solved once,
     from the server's network, not from every user's.
   - 1000 users watching BTCUSDT collapse into 1 upstream connection
     instead of 1000.
   - Reconnection/backoff logic lives in one place.
   ════════════════════════════════════════════════════════════ */

type StreamListener = (data: unknown) => void;

interface UpstreamStream {
  ws: WebSocket | null;
  listeners: Set<StreamListener>;
  reconnectTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const streams = new Map<string, UpstreamStream>();

function openUpstream(streamKey: string): void {
  const stream = streams.get(streamKey);
  if (!stream || stream.closed) return;

  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${streamKey}`);
  stream.ws = ws;

  ws.on("message", (raw) => {
    const current = streams.get(streamKey);
    if (!current) return;
    try {
      const parsed = JSON.parse(raw.toString());
      for (const listener of current.listeners) listener(parsed);
    } catch {
      // ignore malformed frame
    }
  });

  ws.on("close", () => {
    const current = streams.get(streamKey);
    if (!current || current.closed) return;
    // Only reconnect if someone is still listening.
    if (current.listeners.size === 0) return;
    current.reconnectTimer = setTimeout(() => openUpstream(streamKey), 1500);
  });

  ws.on("error", (err) => {
    logger.warn({ err, streamKey }, "Binance upstream WS error");
    try {
      ws.close();
    } catch {
      /* noop */
    }
  });
}

/**
 * Subscribes to a raw Binance combined-stream key (e.g. "btcusdt@kline_1m"
 * or "btcusdt@trade"). Opens the upstream connection on first subscriber,
 * shares it with everyone else subscribing to the same key. Returns an
 * unsubscribe function — call it when the caller (a WS client) disconnects
 * or switches symbol/timeframe.
 */
export function subscribeToBinanceStream(streamKey: string, listener: StreamListener): () => void {
  let stream = streams.get(streamKey);
  if (!stream) {
    stream = { ws: null, listeners: new Set(), reconnectTimer: null, closed: false };
    streams.set(streamKey, stream);
    openUpstream(streamKey);
  } else if (stream.reconnectTimer) {
    // A reconnect was scheduled after the last listener left just before
    // this new one arrived — nothing else to do, it'll connect shortly.
  }

  stream.listeners.add(listener);

  return () => {
    const current = streams.get(streamKey);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.closed = true;
      if (current.reconnectTimer) clearTimeout(current.reconnectTimer);
      try {
        current.ws?.close();
      } catch {
        /* noop */
      }
      streams.delete(streamKey);
    }
  };
}

export function klineStreamKey(symbol: string, interval: string): string {
  return `${symbol.toLowerCase()}@kline_${interval}`;
}

export function tradeStreamKey(symbol: string): string {
  return `${symbol.toLowerCase()}@trade`;
}
