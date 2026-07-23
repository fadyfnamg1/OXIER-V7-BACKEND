import Signal from "../models/Signal";
import MarketSetting from "../models/MarketSetting";
import { latestPrices } from "./prices.service";
import { logger } from "../lib/logger";

type BroadcastFn = (event: string, data: unknown) => void;
let broadcastFn: BroadcastFn | null = null;

export function setSignalBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emas: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    emas.push(prices[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

function calcMACD(
  prices: number[],
  fast = 12,
  slow = 26,
  signal = 9
): { macd: number; signal: number } {
  if (prices.length < slow + signal) return { macd: 0, signal: 0 };
  const emaFast = calcEMA(prices, fast);
  const emaSlow = calcEMA(prices, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calcEMA(macdLine.slice(-signal * 3), signal);
  return {
    macd: macdLine[macdLine.length - 1],
    signal: signalLine[signalLine.length - 1],
  };
}

const priceHistory: Map<string, number[]> = new Map();

export function recordPriceForSignals(symbol: string, price: number): void {
  const history = priceHistory.get(symbol) || [];
  history.push(price);
  if (history.length > 100) history.shift();
  priceHistory.set(symbol, history);
}

async function generateSignal(symbol: string): Promise<void> {
  const history = priceHistory.get(symbol) || [];
  if (history.length < 30) return;

  const currentPrice = latestPrices.get(symbol)?.price;
  if (!currentPrice) return;

  const rsi = calcRSI(history);
  const { macd, signal: macdSignal } = calcMACD(history);

  const prevHistory = history.slice(0, -1);
  const prevMacd = calcMACD(prevHistory);

  let direction: "buy" | "sell" | null = null;
  if (rsi < 35 && macd > macdSignal && prevMacd.macd <= prevMacd.signal) direction = "buy";
  if (rsi > 65 && macd < macdSignal && prevMacd.macd >= prevMacd.signal) direction = "sell";

  if (!direction) return;

  let strength: "weak" | "moderate" | "strong" = "weak";
  if (rsi < 25 || rsi > 75) strength = "strong";
  else if (rsi < 35 || rsi > 65) strength = "moderate";

  const signalDoc = new Signal({
    symbol,
    direction,
    timeframe: "1m",
    rsi,
    macd,
    macdSignal,
    strength,
    entryPrice: currentPrice,
    generatedAt: new Date(),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  });

  await signalDoc.save();

  if (broadcastFn) {
    broadcastFn("signal", {
      symbol,
      direction,
      timeframe: "1m",
      strength,
      rsi,
      macd,
      entryPrice: currentPrice,
    });
  }
}

export function startSignalsEngine(): void {
  logger.info("Signals engine started");
  setInterval(async () => {
    try {
      const markets = await MarketSetting.find({ isActive: true });
      for (const market of markets) {
        const price = latestPrices.get(market.symbol)?.price;
        if (price) recordPriceForSignals(market.symbol, price);
      }
      await Promise.allSettled(markets.map((m) => generateSignal(m.symbol)));
    } catch (err) {
      logger.error({ err }, "Signals engine error");
    }
  }, 30000);
}
