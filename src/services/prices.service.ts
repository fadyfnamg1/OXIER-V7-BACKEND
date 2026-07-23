import { logger } from "../lib/logger";
import { TTLCache } from "../lib/ttl-cache";
import MarketSetting from "../models/MarketSetting";

/* ════════════════════════════════════════════════════════════
   REAL MARKET DATA — Bybit v5 public API
   Switched from Binance because Binance geo-blocks a large range
   of cloud/hosting IPs (including Railway's), which made every
   request from the server fail with a 451. Bybit's public market
   endpoints are open to the same hosting ranges.
   Mirrors the same source the frontend chart uses, so prices,
   pairs and payouts always match what the user sees on the chart.
   ════════════════════════════════════════════════════════════ */

const BYBIT_BASE = "https://api.bybit.com/v5";

// Manual icon overrides for assets whose CoinCap icon is missing/wrong.
// Keep this in sync with the frontend's getFlagUrl() overrides.
const ICON_OVERRIDES: Record<string, string> = {
  ton: "https://i.ibb.co/S4RSYZjM/image.png",
  xlm: "https://i.ibb.co/k2v65TWY/image.png",
  hmstr: "https://i.ibb.co/3ynGyxFd/image.png",
  jto: "https://i.ibb.co/xSmTQrKx/image.png",
  sto: "https://i.ibb.co/SDjfgTjx/image.png",
  bfusd: "https://i.ibb.co/wZscBNdr/image.png",
  mega: "https://i.ibb.co/r1WqGKx/image.png",
  bio: "https://i.ibb.co/mFHtKm2M/image.png",
  chib: "https://i.ibb.co/d068g75s/image.png",
  u: "https://i.ibb.co/Kp7F36tp/image.png",
  resolve: "https://i.ibb.co/HSsC4xz/image.png",
  home: "https://i.ibb.co/V0kwYh8Y/image.png",
  opg: "https://i.ibb.co/4R6wgtHP/image.png",
  vic: "https://i.ibb.co/W4mpQMP0/image.png",
  aster: "https://i.ibb.co/kgYKK2dD/image.png",
  saga: "https://i.ibb.co/YFm1FpZB/image.png",
  re: "https://i.ibb.co/8ngF25Zt/image.png",
  io: "https://i.ibb.co/qYxfvk6n/image.png",
  bico: "https://i.ibb.co/Q7856V58/image.png",
  mmt: "https://i.ibb.co/qY633mcT/image.png",
  zro: "https://i.ibb.co/Gvr99ff7/image.png",
  syn: "https://i.ibb.co/rJfq6sK/image.png",
  lumia: "https://i.ibb.co/spjgrhz8/image.png",
  xpl: "https://i.ibb.co/vv3rQNv5/image.png",
  spcxb: "https://i.ibb.co/vx2xb3bg/image.png",
  allo: "https://i.ibb.co/mFTnzcSx/image.png",
  w: "https://i.ibb.co/5x6yDwtp/image.png",
  tnsr: "https://i.ibb.co/ksmGxYTr/image.png",
};

const GOLD_BASES = new Set(["PAXG", "XAUT"]);
const FOREX_BASES = new Set(["EUR", "GBP", "AUD", "CAD", "CHF", "JPY", "NZD", "TRY", "BRL", "MXN"]);

function getCategory(base: string): "crypto" | "gold" | "forex" {
  if (GOLD_BASES.has(base)) return "gold";
  if (FOREX_BASES.has(base)) return "forex";
  return "crypto";
}

function getIconUrl(base: string): string {
  const lower = base.toLowerCase();
  if (ICON_OVERRIDES[lower]) return ICON_OVERRIDES[lower];
  return `https://assets.coincap.io/assets/icons/${lower}@2x.png`;
}

function getDecimals(price: number): number {
  if (price >= 100) return 2;
  if (price >= 10) return 3;
  if (price >= 1) return 4;
  if (price >= 0.1) return 5;
  if (price >= 0.01) return 6;
  return 8;
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

function toBybitInterval(interval: string): string {
  return INTERVAL_MAP[interval] || interval;
}

interface BybitInstrument {
  symbol: string;
  baseCoin: string;
  quoteCoin: string;
  status: string;
}

interface BybitTicker {
  symbol: string;
  lastPrice: string;
  turnover24h: string;
  volume24h: string;
  price24hPcnt: string;
  highPrice24h: string;
  lowPrice24h: string;
}

interface BybitResponse<T> {
  retCode: number;
  retMsg: string;
  result: { list: T[] };
}

export const latestPrices: Map<string, { price: number; timestamp: number }> = new Map();

type BroadcastFn = (event: string, data: unknown) => void;
let broadcastFn: BroadcastFn | null = null;

export function setBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

/**
 * Pulls the full list of live USDT spot trading pairs from Bybit and
 * upserts them into MarketSetting. Existing admin overrides
 * (isActive, payoutPct, etc.) on already-known symbols are preserved —
 * only new symbols get defaults inserted.
 */
export async function syncMarketsFromBybit(): Promise<void> {
  try {
    const [instrumentsRes, tickersRes] = await Promise.all([
      fetch(`${BYBIT_BASE}/market/instruments-info?category=spot`, { signal: AbortSignal.timeout(10000) }),
      fetch(`${BYBIT_BASE}/market/tickers?category=spot`, { signal: AbortSignal.timeout(10000) }),
    ]);

    if (!instrumentsRes.ok || !tickersRes.ok) {
      throw new Error(`Bybit responded with ${instrumentsRes.status}/${tickersRes.status}`);
    }

    const instruments = (await instrumentsRes.json()) as BybitResponse<BybitInstrument>;
    const tickers = (await tickersRes.json()) as BybitResponse<BybitTicker>;

    if (instruments.retCode !== 0 || tickers.retCode !== 0) {
      throw new Error(`Bybit API error: ${instruments.retMsg || tickers.retMsg}`);
    }

    const tickerMap = new Map(tickers.result.list.map((t) => [t.symbol, t]));

    const pairs = instruments.result.list
      .filter((s) => s.status === "Trading" && s.quoteCoin === "USDT" && /^[A-Z0-9]+$/.test(s.baseCoin))
      .map((s) => {
        const ticker = tickerMap.get(s.symbol);
        const price = parseFloat(ticker?.lastPrice || "0");
        const volume = parseFloat(ticker?.turnover24h || "0");
        return { symbol: s.symbol, baseAsset: s.baseCoin, price, volume };
      })
      .sort((a, b) => b.volume - a.volume);

    if (pairs.length === 0) {
      logger.warn("Bybit returned zero tradable USDT pairs — skipping sync");
      return;
    }

    // Only the top-volume pairs are activated for trading by default.
    // The full Bybit pair list is still synced into MarketSetting
    // (so the admin panel can browse/activate any of them), but only
    // these start out tradable — activating every single USDT pair
    // would flood the price feed, signals engine and every
    // connected client's WebSocket with thousands of updates a second.
    const DEFAULT_ACTIVE_COUNT = 30;
    const activeSymbols = new Set(pairs.slice(0, DEFAULT_ACTIVE_COUNT).map((p) => p.symbol));

    const ops = pairs.map((p) => ({
      updateOne: {
        filter: { symbol: p.symbol },
        update: {
          $setOnInsert: {
            symbol: p.symbol,
            baseAsset: p.baseAsset,
            displayName: `${p.baseAsset}/USDT`,
            category: getCategory(p.baseAsset),
            icon: getIconUrl(p.baseAsset),
            decimals: getDecimals(p.price),
            payoutPct: 82 + Math.floor(Math.random() * 12),
            isActive: activeSymbols.has(p.symbol),
            source: "bybit",
          },
        },
        upsert: true,
      },
    }));

    await MarketSetting.bulkWrite(ops, { ordered: false });

    // Seed initial prices immediately so trades aren't blocked waiting for the first poll.
    for (const p of pairs) {
      if (p.price > 0) {
        latestPrices.set(p.symbol, { price: p.price, timestamp: Date.now() });
      }
    }

    logger.info({ count: pairs.length }, "Markets synced from Bybit");
  } catch (err) {
    logger.error({ err }, "Failed to sync markets from Bybit");
  }
}

async function fetchAllPrices(symbols: string[]): Promise<void> {
  try {
    const res = await fetch(`${BYBIT_BASE}/market/tickers?category=spot`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as BybitResponse<BybitTicker>;
    if (json.retCode !== 0) throw new Error(json.retMsg);
    const wanted = new Set(symbols);
    const now = Date.now();
    for (const row of json.result.list) {
      if (!wanted.has(row.symbol)) continue;
      const price = parseFloat(row.lastPrice);
      if (Number.isFinite(price) && price > 0) {
        latestPrices.set(row.symbol, { price, timestamp: now });
      }
    }
  } catch (err) {
    logger.error({ err }, "Failed to fetch prices from Bybit");
  }
}

/**
 * Starts the live price feed: re-syncs the market/pair list from Bybit
 * periodically (new listings, delistings) and polls live prices for all
 * active markets, broadcasting them over WebSocket.
 */
export function startPriceFeed(): void {
  logger.info("Price feed started (Bybit)");

  const broadcastPrices = async (): Promise<void> => {
    if (!broadcastFn) return;
    const markets = await MarketSetting.find({ isActive: true }).select("symbol").lean();
    const symbols = markets.map((m) => m.symbol);
    if (symbols.length === 0) return;

    await fetchAllPrices(symbols);

    for (const symbol of symbols) {
      const data = latestPrices.get(symbol);
      if (data) {
        broadcastFn("price_update", { symbol, price: data.price, timestamp: data.timestamp });
      }
    }
  };

  // Initial sync, then poll prices every 2s and re-sync the pair list every hour.
  void broadcastPrices();
  setInterval(() => void broadcastPrices(), 2000);
  setInterval(() => void syncMarketsFromBybit(), 60 * 60 * 1000);
}

export function getLatestPrice(symbol: string): number | null {
  return latestPrices.get(symbol)?.price ?? null;
}

/* ════════════════════════════════════════════════════════════
   KLINES PROXY — replaces the frontend's direct calls to
   Binance's /api/v3/klines with Bybit's /v5/market/kline.

   Moving this server-side means:
   - Geo-blocked / CORS-broken browsers never see the problem —
     the request leaves from the Railway server's IP, not the user's.
   - Pagination happens once here instead of once per browser tab,
     and identical requests arriving close together (many users
     opening the same pair) are coalesced via the TTL cache below
     instead of each hitting Bybit separately.
   ════════════════════════════════════════════════════════════ */

const KLINES_MAX_PER_REQUEST = 1000; // Bybit's hard per-request cap
const KLINES_MAX_PAGES = 50; // safety net so a bad response can't loop forever
const KLINES_REQUEST_TIMEOUT_MS = 8000;

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function mapKline(d: unknown[]): Kline {
  return {
    time: Number(d[0]) / 1000,
    open: parseFloat(String(d[1])),
    high: parseFloat(String(d[2])),
    low: parseFloat(String(d[3])),
    close: parseFloat(String(d[4])),
    volume: parseFloat(String(d[5])),
  };
}

const klinesCache = new TTLCache<Kline[]>();

/**
 * Fetches up to `limit` klines for `symbol`/`interval`, paginating
 * backwards through Bybit's history when `limit` exceeds the
 * per-request cap of 1000. Results are cached briefly so a burst of
 * users opening the same chart only triggers one round-trip to Bybit.
 */
export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const cacheKey = `${symbol}:${interval}:${limit}`;
  // Short TTL: long enough to absorb a burst of simultaneous page loads,
  // short enough that the chart's own live WebSocket feed (not this
  // endpoint) remains the source of truth for anything time-sensitive.
  return klinesCache.getOrFetch(cacheKey, 3000, () => fetchKlinesUncached(symbol, interval, limit));
}

async function fetchKlinePage(
  symbol: string,
  bybitInterval: string,
  pageLimit: number,
  endTime?: number,
): Promise<unknown[][]> {
  let url = `${BYBIT_BASE}/market/kline?category=spot&symbol=${symbol}&interval=${bybitInterval}&limit=${pageLimit}`;
  if (endTime !== undefined) url += `&end=${endTime}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(KLINES_REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Bybit klines API: ${res.status}`);
  const json = (await res.json()) as BybitResponse<unknown[]>;
  if (json.retCode !== 0) throw new Error(`Bybit klines API: ${json.retMsg}`);
  // Bybit returns candles newest-first; flip to chronological (oldest-first)
  // to match what the rest of the app (and the old Binance response shape) expects.
  return (json.result.list as unknown[][]).slice().reverse();
}

async function fetchKlinesUncached(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const bybitInterval = toBybitInterval(interval);

  if (limit <= KLINES_MAX_PER_REQUEST) {
    const page = await fetchKlinePage(symbol, bybitInterval, limit);
    return page.map(mapKline);
  }

  let allRaw: unknown[][] = [];
  let remaining = limit;
  let endTime: number | undefined;
  let pages = 0;

  while (remaining > 0 && pages < KLINES_MAX_PAGES) {
    const pageLimit = Math.min(remaining, KLINES_MAX_PER_REQUEST);
    const page = await fetchKlinePage(symbol, bybitInterval, pageLimit, endTime);
    if (!page.length) break;

    allRaw = [...page, ...allRaw];
    remaining -= page.length;
    endTime = Number(page[0]![0]) - 1; // oldest candle in this page, minus 1ms, for the next (earlier) page
    pages++;

    if (page.length < pageLimit) break;
  }

  return allRaw.map(mapKline);
}

/* ════════════════════════════════════════════════════════════
   SINGLE-SYMBOL TICKER PRICE — replaces the frontend's direct
   calls to /api/v3/ticker/price?symbol=... used for short-timeframe
   (5s/10s/30s simulated) chart polling.
   ════════════════════════════════════════════════════════════ */

const tickerPriceCache = new TTLCache<number>();

export async function getTickerPrice(symbol: string): Promise<number | null> {
  // Prefer the already-live-polled price for active markets — no network
  // call needed at all in the common case.
  const known = latestPrices.get(symbol);
  if (known && Date.now() - known.timestamp < 5000) return known.price;

  try {
    return await tickerPriceCache.getOrFetch(symbol, 1000, async () => {
      const res = await fetch(`${BYBIT_BASE}/market/tickers?category=spot&symbol=${symbol}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Bybit ticker API: ${res.status}`);
      const json = (await res.json()) as BybitResponse<BybitTicker>;
      if (json.retCode !== 0) throw new Error(json.retMsg);
      return parseFloat(json.result.list[0]?.lastPrice || "0");
    });
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to fetch ticker price");
    return null;
  }
}

/* ════════════════════════════════════════════════════════════
   LIVE MARKETS LIST — replaces the frontend's direct calls to
   Binance's /api/v3/exchangeInfo + /api/v3/ticker/24hr
   (buildBinanceMarkets) with Bybit's instruments-info + tickers.
   ════════════════════════════════════════════════════════════ */

export interface LiveMarket {
  id: string;
  symbol: string;
  base: string;
  name: string;
  category: "Crypto" | "Gold";
  payout: number;
  price: number;
  dec: number;
  change: number;
  high24: number;
  low24: number;
  volume24: number;
  volume: number;
}

const EXCLUDED_SUFFIXES = ["UPUSDT", "DOWNUSDT", "BULLUSDT", "BEARUSDT"];

const liveMarketsCache = new TTLCache<LiveMarket[]>();

async function fetchLiveMarketsUncached(): Promise<LiveMarket[]> {
  const [instrumentsRes, tickersRes] = await Promise.all([
    fetch(`${BYBIT_BASE}/market/instruments-info?category=spot`, { signal: AbortSignal.timeout(10000) }),
    fetch(`${BYBIT_BASE}/market/tickers?category=spot`, { signal: AbortSignal.timeout(10000) }),
  ]);

  if (!instrumentsRes.ok || !tickersRes.ok) {
    throw new Error(`Bybit responded with ${instrumentsRes.status}/${tickersRes.status}`);
  }

  const instruments = (await instrumentsRes.json()) as BybitResponse<BybitInstrument>;
  const tickers = (await tickersRes.json()) as BybitResponse<BybitTicker>;

  if (instruments.retCode !== 0 || tickers.retCode !== 0) {
    throw new Error(`Bybit API error: ${instruments.retMsg || tickers.retMsg}`);
  }

  const tickerMap = new Map(tickers.result.list.map((t) => [t.symbol, t]));

  const pairs = instruments.result.list.filter(
    (s) =>
      s.quoteCoin === "USDT" &&
      s.status === "Trading" &&
      !EXCLUDED_SUFFIXES.some((suf) => s.symbol.endsWith(suf)) &&
      tickerMap.has(s.symbol),
  );

  const markets: LiveMarket[] = pairs
    .map((s) => {
      const t = tickerMap.get(s.symbol)!;
      const price = parseFloat(t.lastPrice) || 0;
      const base = s.baseCoin;
      const category: "Crypto" | "Gold" = GOLD_BASES.has(base) ? "Gold" : "Crypto";
      return {
        id: base.toLowerCase(),
        symbol: s.symbol,
        base,
        name: base,
        category,
        payout: category === "Gold" ? 76 : 80,
        price,
        dec: getDecimals(price),
        change: (parseFloat(t.price24hPcnt) || 0) * 100,
        high24: parseFloat(t.highPrice24h) || price * 1.02,
        low24: parseFloat(t.lowPrice24h) || price * 0.98,
        volume24: parseFloat(t.volume24h) || 0,
        volume: parseFloat(t.turnover24h) || 0,
      };
    })
    .sort((a, b) => b.volume - a.volume);

  if (markets.length === 0) throw new Error("No live pairs returned");
  return markets;
}

/**
 * Returns the full live Bybit USDT market list (cached ~5s so a wave of
 * users opening the app at once doesn't each trigger their own instruments-info
 * + tickers round-trip). Falls back to whatever MarketSetting + last
 * known prices are in the DB if Bybit itself is unreachable, so the
 * platform never breaks for users even if Bybit is fully blocked.
 */
export async function getLiveMarkets(): Promise<LiveMarket[]> {
  try {
    return await liveMarketsCache.getOrFetch("all", 5000, fetchLiveMarketsUncached);
  } catch (err) {
    logger.warn({ err }, "Live markets fetch failed, falling back to DB snapshot");
    const dbMarkets = await MarketSetting.find().lean();
    return dbMarkets.map((m) => {
      const known = latestPrices.get(m.symbol);
      const price = known?.price ?? 0;
      return {
        id: m.baseAsset.toLowerCase(),
        symbol: m.symbol,
        base: m.baseAsset,
        name: m.baseAsset,
        category: m.category === "gold" ? "Gold" : "Crypto",
        payout: m.payoutPct,
        price,
        dec: m.decimals,
        change: 0,
        high24: price * 1.02,
        low24: price * 0.98,
        volume24: 0,
        volume: 0,
      };
    });
  }
}
