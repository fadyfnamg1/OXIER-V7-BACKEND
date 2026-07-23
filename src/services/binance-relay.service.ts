import WebSocket from "ws";
import { logger } from "../lib/logger";
import { isPerpSymbol } from "./prices.service";

/* ════════════════════════════════════════════════════════════
   BINANCE WS RELAY

   Replaces the frontend's direct browser connections to
   wss://stream.binance.com. Instead, this server keeps ONE upstream
   Binance socket per distinct stream (e.g. "btcusdt@kline_1m") no
   matter how many users are watching it, and fans the messages out
   to every subscribed client over our own /ws endpoint.

   SPOT vs PERP ROUTING:
   BTC, ETH and LTC stream from Binance spot (stream.binance.com), same
   as before. Every other symbol streams from Binance USDⓈ-M perpetual
   futures instead (fstream.binance.com) — see isPerpSymbol() in
   prices.service.ts — because perp candles are deeper/cleaner for
   lower-cap alts. Binance Futures also migrated its WS streams behind
   routed paths (/public, /market, /private); kline and aggTrade both
   live under /market, so perp connections go to
   wss://fstream.binance.com/market/ws/<streamKey>.
   Perp futures doesn't have a raw "@trade" stream — only "@aggTrade" —
   so tradeStreamKey() picks the right suffix per symbol below. Both
   payload shapes carry the same "p" (price) field, so nothing downstream
   in ws.server.ts needs to change to handle it.

   Benefits over "every browser dials Binance directly":
   - Geo-blocking / connectivity issues only need to be solved once,
     from the server's network, not from every user's.
   - 1000 users watching BTCUSDT collapse into 1 upstream connection
     instead of 1000.
   - Reconnection/backoff logic lives in one place.
   ════════════════════════════════════════════════════════════ */

const SPOT_WS_BASE = "wss://stream.binance.com:9443/ws";
const FUTURES_WS_BASE = "wss://fstream.binance.com/market/ws"; // kline & aggTrade live under /market

type StreamListener = (data: unknown) => void;

interface UpstreamStream {
  ws: WebSocket | null;
  listeners: Set<StreamListener>;
  reconnectTimer: NodeJS.Timeout | null;
  closed: boolean;
}

const streams = new Map<string, UpstreamStream>();

function getUpstreamUrl(streamKey: string): string {
  const symbol = (streamKey.split("@")[0] || "").toUpperCase();
  const base = isPerpSymbol(symbol) ? FUTURES_WS_BASE : SPOT_WS_BASE;
  return `${base}/${streamKey}`;
}

function openUpstream(streamKey: string): void {
  const stream = streams.get(streamKey);
  if (!stream || stream.closed) return;

  const ws = new WebSocket(getUpstreamUrl(streamKey));
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
 * Subscribes to a raw Binance stream key (e.g. "btcusdt@kline_1m",
 * "btcusdt@trade" for spot symbols, or "solusdt@aggTrade" for perp
 * symbols). Opens the upstream connection on first subscriber, shares it
 * with everyone else subscribing to the same key. Returns an unsubscribe
 * function — call it when the caller (a WS client) disconnects or
 * switches symbol/timeframe.
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
  // Binance Futures doesn't expose a raw per-trade stream — only
  // aggregated trades. Spot symbols keep using the raw @trade stream.
  const suffix = isPerpSymbol(symbol.toUpperCase()) ? "aggTrade" : "trade";
  return `${symbol.toLowerCase()}@${suffix}`;
}
