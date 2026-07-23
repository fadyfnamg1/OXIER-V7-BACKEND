import WebSocket from "ws";
import { logger } from "../lib/logger";

/* ════════════════════════════════════════════════════════════
   BYBIT WS RELAY
   (replaces binance-relay.service.ts)

   Replaces the frontend's direct browser connections to a live
   exchange feed. Instead, this server keeps ONE upstream Bybit
   socket per distinct topic (e.g. "kline.1.BTCUSDT") no matter how
   many users are watching it, and fans the messages out to every
   subscribed client over our own /ws endpoint.

   Switched from Binance to Bybit because Binance geo-blocks a large
   range of cloud/hosting IPs (including Railway's) — both the REST
   API and the WS upstream failed from the server's network. Bybit's
   public endpoints are reachable from those same ranges.

   Benefits over "every browser dials the exchange directly":
   - Geo-blocking / connectivity issues only need to be solved once,
     from the server's network, not from every user's.
   - 1000 users watching BTCUSDT collapse into 1 upstream connection
     instead of 1000.
   - Reconnection/backoff logic lives in one place.
   ════════════════════════════════════════════════════════════ */

const BYBIT_WS_URL = "wss://stream.bybit.com/v5/public/spot";
const PING_INTERVAL_MS = 20000; // Bybit closes idle connections without a periodic ping

type StreamListener = (data: unknown) => void;

interface UpstreamStream {
  ws: WebSocket | null;
  listeners: Set<StreamListener>;
  reconnectTimer: NodeJS.Timeout | null;
  pingTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const streams = new Map<string, UpstreamStream>();

function openUpstream(topic: string): void {
  const stream = streams.get(topic);
  if (!stream || stream.closed) return;

  const ws = new WebSocket(BYBIT_WS_URL);
  stream.ws = ws;

  ws.on("open", () => {
    ws.send(JSON.stringify({ op: "subscribe", args: [topic] }));

    const current = streams.get(topic);
    if (current) {
      current.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "ping" }));
      }, PING_INTERVAL_MS);
    }
  });

  ws.on("message", (raw) => {
    const current = streams.get(topic);
    if (!current) return;
    try {
      const parsed = JSON.parse(raw.toString());
      // Ignore subscribe/ping/pong acks — only forward actual topic data.
      if (parsed.topic !== topic) return;
      for (const listener of current.listeners) listener(parsed);
    } catch {
      // ignore malformed frame
    }
  });

  ws.on("close", () => {
    const current = streams.get(topic);
    if (!current) return;
    if (current.pingTimer) {
      clearInterval(current.pingTimer);
      current.pingTimer = null;
    }
    if (current.closed) return;
    // Only reconnect if someone is still listening.
    if (current.listeners.size === 0) return;
    current.reconnectTimer = setTimeout(() => openUpstream(topic), 1500);
  });

  ws.on("error", (err) => {
    logger.warn({ err, topic }, "Bybit upstream WS error");
    try {
      ws.close();
    } catch {
      /* noop */
    }
  });
}

/**
 * Subscribes to a raw Bybit v5 public topic (e.g. "kline.1.BTCUSDT" or
 * "publicTrade.BTCUSDT"). Opens the upstream connection on first subscriber,
 * shares it with everyone else subscribing to the same topic. Returns an
 * unsubscribe function — call it when the caller (a WS client) disconnects
 * or switches symbol/timeframe.
 */
export function subscribeToBybitStream(topic: string, listener: StreamListener): () => void {
  let stream = streams.get(topic);
  if (!stream) {
    stream = { ws: null, listeners: new Set(), reconnectTimer: null, pingTimer: null, closed: false };
    streams.set(topic, stream);
    openUpstream(topic);
  } else if (stream.reconnectTimer) {
    // A reconnect was scheduled after the last listener left just before
    // this new one arrived — nothing else to do, it'll connect shortly.
  }

  stream.listeners.add(listener);

  return () => {
    const current = streams.get(topic);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size === 0) {
      current.closed = true;
      if (current.reconnectTimer) clearTimeout(current.reconnectTimer);
      if (current.pingTimer) clearInterval(current.pingTimer);
      try {
        current.ws?.close();
      } catch {
        /* noop */
      }
      streams.delete(topic);
    }
  };
}

// Maps our internal ("Binance-style") interval strings — still used
// throughout the frontend and ws.server.ts — to Bybit's kline interval codes.
const INTERVAL_MAP: Record<string, string> = {
  "1m": "1",
  "3m": "3",
  "5m": "5",
  "15m": "15",
  "30m": "30",
  "1h": "60",
  "2h": "120",
  "4h": "240",
  "6h": "360",
  "12h": "720",
  "1d": "D",
  "1w": "W",
  "1M": "M",
};

export function klineStreamKey(symbol: string, interval: string): string {
  const bybitInterval = INTERVAL_MAP[interval] || interval;
  return `kline.${bybitInterval}.${symbol.toUpperCase()}`;
}

export function tradeStreamKey(symbol: string): string {
  return `publicTrade.${symbol.toUpperCase()}`;
}
