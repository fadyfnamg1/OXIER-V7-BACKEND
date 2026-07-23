import mongoose from "mongoose";
import Trade from "../models/Trade";
import User from "../models/User";
import MarketSetting from "../models/MarketSetting";
import { getLatestPrice } from "./prices.service";
import { processTurnoverCommission } from "./commission.service";
import { logger } from "../lib/logger";

type BroadcastFn = (event: string, data: unknown, userId?: string) => void;
let broadcastFn: BroadcastFn | null = null;

export function setTradeBroadcast(fn: BroadcastFn): void {
  broadcastFn = fn;
}

export async function openTrade(params: {
  userId: string;
  marketSymbol: string;
  side: "buy" | "sell";
  amount: number;
  expirySeconds: number;
  walletType: "demo" | "real";
  entryPrice: number;
}): Promise<{ trade: InstanceType<typeof Trade> }> {
  if (!Number.isFinite(params.amount) || params.amount <= 0)
    throw new Error("Trade amount must be a positive number");
  if (!Number.isFinite(params.expirySeconds) || params.expirySeconds < 15 || params.expirySeconds > 3600)
    throw new Error("Expiry must be between 15 seconds and 1 hour");
  if (params.side !== "buy" && params.side !== "sell")
    throw new Error("Invalid trade side");
  if (!Number.isFinite(params.entryPrice) || params.entryPrice <= 0)
    throw new Error("Invalid entry price");

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const user = await User.findById(params.userId).session(session);
    if (!user) throw new Error("User not found");

    const market = await MarketSetting.findOne({ symbol: params.marketSymbol, isActive: true });
    if (!market) throw new Error("Market not found or inactive");

    const balanceField = params.walletType === "demo" ? "demoBalance" : "realBalance";
    const debited = await User.findOneAndUpdate(
      { _id: params.userId, [balanceField]: { $gte: params.amount } },
      { $inc: { [balanceField]: -params.amount } },
      { session, new: true }
    );
    if (!debited) throw new Error("Insufficient balance");

    const expiryAt = new Date(Date.now() + params.expirySeconds * 1000);
    const [trade] = await Trade.create(
      [{
        userId: user._id,
        marketSymbol: params.marketSymbol,
        marketName: market.displayName,
        side: params.side,
        amount: params.amount,
        entryPrice: params.entryPrice,
        payoutPct: market.payoutPct,
        expirySeconds: params.expirySeconds,
        openedAt: new Date(),
        expiryAt,
        status: "open",
        walletType: params.walletType,
      }],
      { session }
    );

    await session.commitTransaction();
    scheduleTradeClosure(trade._id.toString(), params.expirySeconds * 1000);
    return { trade };
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
  }
}

export function scheduleTradeClosure(tradeId: string, delayMs: number): void {
  setTimeout(async () => {
    try {
      await resolveTrade(tradeId);
    } catch (err) {
      logger.error({ err, tradeId }, "Error resolving trade");
    }
  }, delayMs);
}

// Client (Flutter) submits the exit price when its local timer fires.
// Validates timing ±30s of expiryAt. Returns early if trade already settled
// by the server-side timer.
export async function settleTradeWithClientPrice(
  tradeId: string,
  userId: string,
  exitPrice: number
): Promise<void> {
  if (!Number.isFinite(exitPrice) || exitPrice <= 0)
    throw new Error("Invalid exit price");

  const trade = await Trade.findOne({ _id: tradeId, userId, status: "open" });
  if (!trade) return; // already settled — no-op

  const now = Date.now();
  const expiryMs = trade.expiryAt.getTime();
  if (now < expiryMs - 5000)
    throw new Error("Trade has not expired yet");
  if (now > expiryMs + 30000)
    throw new Error("Settlement window has expired — result already processed");

  await _settle(trade, exitPrice);
}

export async function resolveTrade(tradeId: string): Promise<void> {
  const trade = await Trade.findById(tradeId);
  if (!trade || trade.status !== "open") return;

  // Try the in-memory price feed first. If Railway's IP is blocked by Binance
  // and latestPrices is empty, generate a small random price movement so the
  // result is ~50/50 instead of deterministically always making BUY lose.
  const livePrice = getLatestPrice(trade.marketSymbol);
  const exitPrice = livePrice ?? (trade.entryPrice * (1 + (Math.random() - 0.5) * 0.004));

  await _settle(trade, exitPrice);
}

async function _settle(trade: InstanceType<typeof Trade>, exitPrice: number): Promise<void> {
  // Mark settled first to prevent double-settlement race (server timer + client submit)
  const claimed = await Trade.findOneAndUpdate(
    { _id: trade._id, status: "open" },
    { status: "settling" },
    { new: false }
  );
  if (!claimed) return; // another call already claimed it

  const priceWentUp = exitPrice > trade.entryPrice;
  const won = (trade.side === "buy" && priceWentUp) || (trade.side === "sell" && !priceWentUp);
  const status: "won" | "lost" = won ? "won" : "lost";
  const profit = won ? trade.amount * (trade.payoutPct / 100) : -trade.amount;

  await trade.updateOne({ status, exitPrice, profit, resolvedAt: new Date() });

  if (won) {
    const payout = trade.amount + profit;
    const balanceField = trade.walletType === "demo" ? "demoBalance" : "realBalance";
    await User.findByIdAndUpdate(trade.userId, { $inc: { [balanceField]: payout } });
  } else if (trade.walletType === "real") {
    await processTurnoverCommission(trade.userId as mongoose.Types.ObjectId, trade.amount);
  }

  if (broadcastFn) {
    broadcastFn("trade_result", { tradeId: trade._id, result: status, profit, exitPrice }, trade.userId.toString());
  }
}

export async function earlyCloseTrade(tradeId: string, userId: string): Promise<void> {
  const trade = await Trade.findOne({ _id: tradeId, userId, status: "open" });
  if (!trade) throw new Error("Trade not found");

  const elapsed = Date.now() - trade.openedAt.getTime();
  if (elapsed > 30000) throw new Error("Early close only allowed within 30 seconds of opening");

  const refund = trade.amount * 0.5;
  const balanceField = trade.walletType === "demo" ? "demoBalance" : "realBalance";
  await trade.updateOne({ status: "closed_early", exitPrice: trade.entryPrice, profit: -refund, resolvedAt: new Date() });
  await User.findByIdAndUpdate(userId, { $inc: { [balanceField]: refund } });
}
