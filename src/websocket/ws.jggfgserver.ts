import { WebSocketServer, WebSocket } from "ws";
import http from "http";
import jwt from "jsonwebtoken";
import { logger } from "../lib/logger";
import { subscribeToBybitStream, klineStreamKey, tradeStreamKey } from "../services/bybit-relay.service";

interface WSClient {
  ws: WebSocket;
  userId?: string;
  subscribedSymbols: Set<string>;
  // Live chart streams this client is relayed from Bybit via our server
  // (replaces the frontend's old direct exchange WebSocket connections).
  // Keyed by streamKey -> unsubscribe function, so switching symbol/timeframe
  // or disconnecting cleanly tears down only what this client opened.
  klineSubs: Map<string, () => void>;
  tradeSubs: Map<string, () => void>;
}

function teardownStreamSubs(client: WSClient): void {
  for (const unsub of client.klineSubs.values()) unsub();
  client.klineSubs.clear();
  for (const unsub of client.tradeSubs.values()) unsub();
  client.tradeSubs.clear();
}

const clients: Set<WSClient> = new Set();

export function createWSServer(server: http.Server): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const client: WSClient = {
      ws,
      subscribedSymbols: new Set(),
      klineSubs: new Map(),
      tradeSubs: new Map(),
    };
    clients.add(client);
    logger.info({ ip: req.socket.remoteAddress }, "WS client connected");

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString()) as {
          type: string;
          token?: string;
          symbols?: string[];
          symbol?: string;
          interval?: string;
        };

        if (msg.type === "auth" && msg.token) {
          const secret = process.env["JWT_SECRET"] || "default_secret";
          try {
            const decoded = jwt.verify(msg.token, secret) as { id: string };
            client.userId = decoded.id;
            ws.send(JSON.stringify({ type: "auth_success" }));
          } catch {
            ws.send(JSON.stringify({ type: "auth_error", error: "Invalid token" }));
          }
          return;
        }

        if (msg.type === "subscribe" && msg.symbols) {
          for (const sym of msg.symbols) client.subscribedSymbols.add(sym);
          return;
        }

        if (msg.type === "unsubscribe" && msg.symbols) {
          for (const sym of msg.symbols) client.subscribedSymbols.delete(sym);
          return;
        }

        // ── Live chart streams (relayed from Bybit) ─────────────────────
        // Replaces the frontend's old direct exchange WebSocket
        // connections for candle updates and the high-frequency trade
        // ticker used to smooth price movement between candle updates.

        if (msg.type === "subscribe_kline" && msg.symbol && msg.interval) {
          const key = klineStreamKey(msg.symbol, msg.interval);
          if (client.klineSubs.has(key)) return; // already subscribed
          const unsub = subscribeToBybitStream(key, (data) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            // Bybit kline messages: { topic, type, data: [{ start, open, high, low, close, volume, ... }] }
            const k = (data as any)?.data?.[0];
            if (!k) return;
            ws.send(
              JSON.stringify({
                type: "kline_update",
                symbol: msg.symbol,
                interval: msg.interval,
                data: {
                  time: Number(k.start) / 1000,
                  open: parseFloat(k.open),
                  high: parseFloat(k.high),
                  low: parseFloat(k.low),
                  close: parseFloat(k.close),
                  volume: parseFloat(k.volume),
                },
              }),
            );
          });
          client.klineSubs.set(key, unsub);
          return;
        }

        if (msg.type === "unsubscribe_kline" && msg.symbol && msg.interval) {
          const key = klineStreamKey(msg.symbol, msg.interval);
          client.klineSubs.get(key)?.();
          client.klineSubs.delete(key);
          return;
        }

        if (msg.type === "subscribe_trade" && msg.symbol) {
          const key = tradeStreamKey(msg.symbol);
          if (client.tradeSubs.has(key)) return;
          const unsub = subscribeToBybitStream(key, (data) => {
            if (ws.readyState !== WebSocket.OPEN) return;
            // Bybit trade messages: { topic, type, data: [{ p: price, v: volume, ... }] }
            const price = parseFloat((data as any)?.data?.[0]?.p);
            if (!Number.isFinite(price)) return;
            ws.send(JSON.stringify({ type: "trade_tick", symbol: msg.symbol, price }));
          });
          client.tradeSubs.set(key, unsub);
          return;
        }

        if (msg.type === "unsubscribe_trade" && msg.symbol) {
          const key = tradeStreamKey(msg.symbol);
          client.tradeSubs.get(key)?.();
          client.tradeSubs.delete(key);
          return;
        }
      } catch {
        logger.warn("Invalid WS message");
      }
    });

    ws.on("close", () => {
      teardownStreamSubs(client);
      clients.delete(client);
    });

    ws.on("error", (err) => {
      logger.error({ err }, "WS error");
      teardownStreamSubs(client);
      clients.delete(client);
    });

    ws.send(JSON.stringify({ type: "connected", message: "OXIER WebSocket ready" }));
  });
}

export function broadcast(event: string, data: unknown, targetUserId?: string): void {
  const message = JSON.stringify({ type: event, data, timestamp: Date.now() });

  for (const client of clients) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;

    if (targetUserId && client.userId !== targetUserId) continue;

    if (event === "price_update" || event === "signal") {
      const symbol = (data as { symbol?: string }).symbol;
      if (symbol && client.subscribedSymbols.size > 0 && !client.subscribedSymbols.has(symbol)) continue;
    }

    try {
      client.ws.send(message);
    } catch {
      clients.delete(client);
    }
  }
  }
