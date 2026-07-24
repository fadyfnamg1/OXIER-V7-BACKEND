import { logger } from "../lib/logger";
import { TTLCache } from "../lib/ttl-cache";
import MarketSetting from "../models/MarketSetting";

/* ════════════════════════════════════════════════════════════
   REAL MARKET DATA — Binance public API

   Mirrors the same source the frontend chart uses, so prices,
   pairs and payouts always match what the user sees on the chart.

   SPOT vs PERP ROUTING:
   BTC, ETH and LTC are priced/charted from Binance SPOT (api.binance.com).
   Every other symbol is priced/charted from Binance USDⓈ-M PERPETUAL
   FUTURES (fapi.binance.com) instead, because the perp market is deeper
   and its candles are cleaner/less choppy for lower-cap alts than spot.
   A symbol only actually uses perp if it's both (a) not in the
   spot-only list and (b) actually listed as a USDT perpetual on Binance
   Futures — anything not listed there quietly falls back to spot so it
   never just breaks.
   ════════════════════════════════════════════════════════════ */

const SPOT_BASE = "https://api.binance.com/api/v3";
const FUTURES_BASE = "https://fapi.binance.com/fapi/v1";
const FUTURES_WS_BASE = "wss://fstream.binance.com/market/ws"; // kline & aggTrade both live under the /market routed path
const SPOT_WS_BASE = "wss://stream.binance.com:9443/ws";

// These three always use spot, regardless of futures availability.
const SPOT_ONLY_SYMBOLS = new Set(["BTCUSDT", "ETHUSDT", "LTCUSDT"]);

// Populated by refreshPerpSymbols() — the live set of USDT perpetuals
// currently tradable on Binance Futures. Refreshed alongside the hourly
// market sync so newly-listed/delisted perp contracts stay in sync.
let perpSymbols = new Set<string>();

/**
 * Whether `symbol` should be sourced from Binance USDⓈ-M perpetual
 * futures rather than spot. Exported so the WS relay (binance-relay.service.ts)
 * can route its upstream connections the same way.
 */
export function isPerpSymbol(symbol: string): boolean {
  return !SPOT_ONLY_SYMBOLS.has(symbol) && perpSymbols.has(symbol);
}

function getRestBase(symbol: string): string {
  return isPerpSymbol(symbol) ? FUTURES_BASE : SPOT_BASE;
}

/** WS base URL (including routed path) for a given already-built stream key, e.g. "btcusdt@kline_1m". */
export function getWsBaseForStream(streamKey: string): string {
  const symbol = (streamKey.split("@")[0] || "").toUpperCase();
  return isPerpSymbol(symbol) ? FUTURES_WS_BASE : SPOT_WS_BASE;
}

async function refreshPerpSymbols(): Promise<void> {
  try {
    const res = await fetch(`${FUTURES_BASE}/exchangeInfo`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      symbols: Array<{ symbol: string; quoteAsset: string; status: string; contractType?: string }>;
    };
    const next = new Set<string>();
    for (const s of json.symbols) {
      if (s.quoteAsset === "USDT" && s.status === "TRADING" && s.contractType === "PERPETUAL") {
        next.add(s.symbol);
      }
    }
    if (next.size > 0) {
      perpSymbols = next;
      logger.info({ count: perpSymbols.size }, "Perp futures symbol list refreshed");
    }
  } catch (err) {
    logger.warn({ err }, "Failed to refresh perp futures symbol list — keeping previous list");
  }
}

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

/* ════════════════════════════════════════════════════════════
   CURATED PAIR LIST — the platform intentionally trades only a
   hand-picked ~100 pairs instead of every USDT pair Binance lists.
   Many low-liquidity/leveraged-style alts produce choppy, gappy
   candles that are a poor fit for short-expiry binary options, so
   they're kept out entirely rather than just hidden in the UI.

   TRENDING_ORDER pins a fixed set of pairs into their own block at the
   top of the list. Within that block — and within the rest of
   CURATED_BASES below it — pairs are ranked by live 24h % change
   (biggest movers first), not by fixed order or volume.

   To add/remove a pair later: just edit these two lists. Anything
   listed here that Binance doesn't currently have a live USDT pair
   for is silently skipped — it won't break the sync.
   ════════════════════════════════════════════════════════════ */

export const TRENDING_ORDER: string[] = [
  "BTC", "BNB", "ETH", "LTC", "SOL", "DOGE", "TRX", "XAUT",
  "DEXE", "ZEC", "RE", "XRP", "ZAMA", "SUI", "BANK", "RIF",
];

// Additional curated pairs (blue-chip / high-liquidity majors, plus a batch
// of more volatile-but-liquid mid-caps the operator specifically asked to
// swap in) that fill out the rest of the 100-pair list, ranked by 24h %
// change (not fixed order, not volume) alongside each other.
const CURATED_OTHER: string[] = [
  // ── Kept from the original blue-chip batch ──────────────────────────
  "DOT", "LINK", "AVAX", "UNI", "MATIC", "TON", "ARB", "FIL", "ALGO", "XMR",
  "XLM", "HBAR", "ETC", "BCH", "EOS", "XTZ", "MANA", "ROSE", "WAVES", "QTUM",
  "OMG", "1INCH", "REN", "BAL", "LDO", "FXS", "GMX", "PYTH", "JUP", "JTO",
  "WLD", "TIA", "MANTA", "ACE", "RON", "GMT", "SKL", "OCEAN", "POND", "DENT",
  "PEOPLE", "HIGH", "LOOM",

  // ── Replacements: more volatile but liquid mid-caps (operator-selected
  // from live Binance USDⓈ-M "Losers" screenshots + generally solid picks) ──
  "AKT", "CVX", "EIGEN", "WIF", "MOVE", "DRIFT", "PHA", "AGLD", "LIT", "SHELL",
  "CGPT", "ID", "SYN", "TLM", "FOLKS", "SENT", "NEIRO", "LUNC", "RENDER", "TAO",
  "ONDO", "ENA", "JASMY", "BONK", "FLOKI", "PENGU", "NOT", "TURBO", "AEVO", "ETHFI",
  "OMNI", "SAGA", "IO", "ZK", "AR", "GRASS", "ME", "VIRTUAL", "LISTA", "BB",
  "TNSR",
];

export const CURATED_BASES: Set<string> = new Set([...TRENDING_ORDER, ...CURATED_OTHER]);

const TRENDING_SET: Set<string> = new Set(TRENDING_ORDER);

/**
 * Sort comparator: trending pairs as one block, everything else as a
 * second block — and *within* each block, ranked by 24h % change,
 * descending (biggest movers first). `change` defaults to 0 for callers
 * that don't have live change data (e.g. the offline DB fallback), which
 * just keeps that block in whatever order it was already in.
 */
function curatedSort<T extends { baseAsset?: string; base?: string; change?: number; volume?: number }>(
  a: T,
  b: T,
): number {
  const baseA = (a.baseAsset ?? a.base)!;
  const baseB = (b.baseAsset ?? b.base)!;
  const trendA = TRENDING_SET.has(baseA);
  const trendB = TRENDING_SET.has(baseB);
  if (trendA !== trendB) return trendA ? -1 : 1;
  const changeA = a.change ?? 0;
  const changeB = b.change ?? 0;
  if (changeA !== changeB) return changeB - changeA;
  return (b.volume ?? 0) - (a.volume ?? 0);
}

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

interface BinanceExchangeSymbol {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  status: string;
}

interface BinanceTicker24hr {
  symbol: string;
  lastPrice: string;
  quoteVolume: string;
  priceChangePercent?: string;
  highPrice?: string;
  lowPrice?: string;
  volume?: string;
}

export const latestPrices: Map<string, { price: number; timestamp: number }> = new Map();

type BroadcastFn = (event: string, data: unknown) => void;
let broadcastFn: BroadcastFn | null = null;

export function setBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

/**
 * Pulls the full list of live USDT trading pairs from Binance and
 * upserts them into MarketSetting. Existing admin overrides
 * (isActive, payoutPct, etc.) on already-known symbols are preserved —
 * only new symbols get defaults inserted.
 */
export async function syncMarketsFromBinance(): Promise<void> {
  try {
    const [exchangeInfoRes, tickersRes] = await Promise.all([
      fetch(`${SPOT_BASE}/exchangeInfo`, { signal: AbortSignal.timeout(10000) }),
      fetch(`${SPOT_BASE}/ticker/24hr`, { signal: AbortSignal.timeout(10000) }),
    ]);

    // Refreshing the perp symbol list doesn't need to block the spot sync
    // above — kick it off in parallel and let it settle on its own.
    void refreshPerpSymbols();

    if (!exchangeInfoRes.ok || !tickersRes.ok) {
      throw new Error(`Binance responded with ${exchangeInfoRes.status}/${tickersRes.status}`);
    }

    const exchangeInfo = (await exchangeInfoRes.json()) as { symbols: BinanceExchangeSymbol[] };
    const tickers = (await tickersRes.json()) as BinanceTicker24hr[];
    const tickerMap = new Map(tickers.map((t) => [t.symbol, t]));

    const pairs = exchangeInfo.symbols
      .filter(
        (s) =>
          s.status === "TRADING" &&
          s.quoteAsset === "USDT" &&
          /^[A-Z0-9]+$/.test(s.baseAsset) &&
          CURATED_BASES.has(s.baseAsset),
      )
      .map((s) => {
        const ticker = tickerMap.get(s.symbol);
        const price = parseFloat(ticker?.lastPrice || "0");
        const volume = parseFloat(ticker?.quoteVolume || "0");
        const change = parseFloat(ticker?.priceChangePercent || "0");
        return { symbol: s.symbol, baseAsset: s.baseAsset, price, volume, change };
      })
      .sort(curatedSort);

    if (pairs.length === 0) {
      logger.warn("Binance returned zero tradable USDT pairs from the curated list — skipping sync");
      return;
    }

    // The platform only trades the curated ~100-pair list (see CURATED_BASES
    // above), so every pair that made it through the filter above starts out
    // active — there's no separate "top volume" cutoff anymore.
    const activeSymbols = new Set(pairs.map((p) => p.symbol));

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
            source: "binance",
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

    logger.info({ count: pairs.length }, "Markets synced from Binance");
  } catch (err) {
    logger.error({ err }, "Failed to sync markets from Binance");
  }
}

async function fetchAllPrices(symbols: string[]): Promise<void> {
  const spotWanted = new Set(symbols.filter((s) => !isPerpSymbol(s)));
  const perpWanted = new Set(symbols.filter((s) => isPerpSymbol(s)));
  const now = Date.now();

  async function pull(base: string, wanted: Set<string>): Promise<void> {
    if (wanted.size === 0) return;
    try {
      const res = await fetch(`${base}/ticker/price`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as Array<{ symbol: string; price: string }>;
      for (const row of data) {
        if (!wanted.has(row.symbol)) continue;
        const price = parseFloat(row.price);
        if (Number.isFinite(price) && price > 0) {
          latestPrices.set(row.symbol, { price, timestamp: now });
        }
      }
    } catch (err) {
      logger.error({ err, base }, "Failed to fetch prices from Binance");
    }
  }

  await Promise.all([pull(SPOT_BASE, spotWanted), pull(FUTURES_BASE, perpWanted)]);
}

/**
 * Starts the live price feed: re-syncs the market/pair list from Binance
 * periodically (new listings, delistings) and polls live prices for all
 * active markets, broadcasting them over WebSocket.
 */
export function startPriceFeed(): void {
  logger.info("Price feed started (Binance)");

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
  setInterval(() => void syncMarketsFromBinance(), 60 * 60 * 1000);
}

export function getLatestPrice(symbol: string): number | null {
  return latestPrices.get(symbol)?.price ?? null;
}

/* ════════════════════════════════════════════════════════════
   KLINES PROXY — replaces the frontend's direct calls to
   https://api.binance.com/api/v3/klines.

   Routed to spot or perp futures per-symbol (see isPerpSymbol above).

   Moving this server-side means:
   - Geo-blocked / CORS-broken browsers never see the problem —
     the request leaves from the Railway server's IP, not the user's.
   - Pagination happens once here instead of once per browser tab,
     and identical requests arriving close together (many users
     opening the same pair) are coalesced via the TTL cache below
     instead of each hitting Binance separately.
   ════════════════════════════════════════════════════════════ */

const KLINES_MAX_PER_REQUEST = 1000; // Binance's hard per-request cap
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
 * backwards through Binance's history when `limit` exceeds the
 * per-request cap of 1000. Results are cached briefly so a burst of
 * users opening the same chart only triggers one round-trip to Binance.
 */
export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const cacheKey = `${symbol}:${interval}:${limit}`;
  // Short TTL: long enough to absorb a burst of simultaneous page loads,
  // short enough that the chart's own live WebSocket feed (not this
  // endpoint) remains the source of truth for anything time-sensitive.
  return klinesCache.getOrFetch(cacheKey, 3000, () => fetchKlinesUncached(symbol, interval, limit));
}

async function fetchKlinesUncached(symbol: string, interval: string, limit: number): Promise<Kline[]> {
  const base = getRestBase(symbol);

  if (limit <= KLINES_MAX_PER_REQUEST) {
    const res = await fetch(
      `${base}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
      { signal: AbortSignal.timeout(KLINES_REQUEST_TIMEOUT_MS) },
    );
    if (!res.ok) throw new Error(`Binance klines API: ${res.status}`);
    const data = (await res.json()) as unknown[][];
    return data.map(mapKline);
  }

  let allRaw: unknown[][] = [];
  let remaining = limit;
  let endTime: number | undefined;
  let pages = 0;

  while (remaining > 0 && pages < KLINES_MAX_PAGES) {
    const pageLimit = Math.min(remaining, KLINES_MAX_PER_REQUEST);
    let url = `${base}/klines?symbol=${symbol}&interval=${interval}&limit=${pageLimit}`;
    if (endTime !== undefined) url += `&endTime=${endTime}`;

    const res = await fetch(url, { signal: AbortSignal.timeout(KLINES_REQUEST_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Binance klines API: ${res.status}`);
    const page = (await res.json()) as unknown[][];
    if (!page.length) break;

    allRaw = [...page, ...allRaw];
    remaining -= page.length;
    endTime = Number(page[0]![0]) - 1;
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
      const res = await fetch(`${getRestBase(symbol)}/ticker/price?symbol=${symbol}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`Binance ticker API: ${res.status}`);
      const data = (await res.json()) as { price: string };
      return parseFloat(data.price);
    });
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to fetch ticker price");
    return null;
  }
}

/* ════════════════════════════════════════════════════════════
   LIVE MARKETS LIST — replaces the frontend's direct calls to
   /api/v3/exchangeInfo + /api/v3/ticker/24hr (buildBinanceMarkets).

   Pair existence/metadata (icon, decimals, category) always comes
   from spot, since spot lists far more assets than futures. But for
   any symbol that's perp-eligible, the live price/change/high/low/
   volume shown here come from the perp ticker instead, so the
   numbers match what the chart (also perp-routed) is showing.
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
  const [exchangeInfo, tickers, futuresTickers] = await Promise.all([
    fetch(`${SPOT_BASE}/exchangeInfo`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()),
    fetch(`${SPOT_BASE}/ticker/24hr`, { signal: AbortSignal.timeout(10000) }).then((r) => r.json()),
    fetch(`${FUTURES_BASE}/ticker/24hr`, { signal: AbortSignal.timeout(10000) })
      .then((r) => (r.ok ? r.json() : []))
      .catch(() => []),
  ]);

  const tickerMap = new Map<string, any>(Array.isArray(tickers) ? tickers.map((t: any) => [t.symbol, t]) : []);
  const futuresTickerMap = new Map<string, any>(
    Array.isArray(futuresTickers) ? futuresTickers.map((t: any) => [t.symbol, t]) : [],
  );
  const symbols: any[] = Array.isArray(exchangeInfo?.symbols) ? exchangeInfo.symbols : [];

  const pairs = symbols.filter(
    (s: any) =>
      s.quoteAsset === "USDT" &&
      s.status === "TRADING" &&
      s.isSpotTradingAllowed !== false &&
      !EXCLUDED_SUFFIXES.some((suf) => s.symbol.endsWith(suf)) &&
      CURATED_BASES.has(s.baseAsset) &&
      tickerMap.has(s.symbol),
  );

  const markets: LiveMarket[] = pairs
    .map((s: any) => {
      const usePerp = isPerpSymbol(s.symbol) && futuresTickerMap.has(s.symbol);
      const t = usePerp ? futuresTickerMap.get(s.symbol) : tickerMap.get(s.symbol);
      const price = parseFloat(t.lastPrice) || 0;
      const base = s.baseAsset;
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
        change: parseFloat(t.priceChangePercent) || 0,
        high24: parseFloat(t.highPrice) || price * 1.02,
        low24: parseFloat(t.lowPrice) || price * 0.98,
        volume24: parseFloat(t.volume) || 0,
        volume: parseFloat(t.quoteVolume) || 0,
      };
    })
    // Trending pairs (TRENDING_ORDER) pinned first in that exact order,
    // then the rest of the curated list sorted by live volume.
    .sort(curatedSort);

  if (markets.length === 0) throw new Error("No live pairs returned");
  return markets;
}

/**
 * Returns the full live Binance USDT market list (cached ~5s so a wave of
 * users opening the app at once doesn't each trigger their own exchangeInfo
 * + ticker/24hr round-trip). Falls back to whatever MarketSetting + last
 * known prices are in the DB if Binance itself is unreachable, so the
 * platform never breaks for users even if Binance is fully blocked.
 */
export async function getLiveMarkets(): Promise<LiveMarket[]> {
  try {
    return await liveMarketsCache.getOrFetch("all", 5000, fetchLiveMarketsUncached);
  } catch (err) {
    logger.warn({ err }, "Live markets fetch failed, falling back to DB snapshot");
    const dbMarkets = await MarketSetting.find({ isActive: true }).lean();
    return dbMarkets
      .map((m) => {
        const known = latestPrices.get(m.symbol);
        const price = known?.price ?? 0;
        return {
          id: m.baseAsset.toLowerCase(),
          symbol: m.symbol,
          base: m.baseAsset,
          name: m.baseAsset,
          category: (m.category === "gold" ? "Gold" : "Crypto") as "Crypto" | "Gold",
          payout: m.payoutPct,
          price,
          dec: m.decimals,
          change: 0,
          high24: price * 1.02,
          low24: price * 0.98,
          volume24: 0,
          volume: 0,
        };
      })
      .sort(curatedSort);
  }
}
