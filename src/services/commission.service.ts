import mongoose from "mongoose";
import Partner from "../models/Partner";
import Commission from "../models/Commission";
import User from "../models/User";
import Transaction from "../models/Transaction";
import { logger } from "../lib/logger";

export async function processTurnoverCommission(
  clientId: mongoose.Types.ObjectId,
  tradeAmount: number
): Promise<void> {
  try {
    const client = await User.findById(clientId);
    if (!client || !client.partnerId) return;

    const partner = await Partner.findById(client.partnerId);
    if (!partner || partner.payoutModel !== "turnover") return;

    const totalDeposits = await Transaction.aggregate([
      { $match: { userId: clientId, type: "deposit", status: "confirmed" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const depositTotal = totalDeposits[0]?.total || 0;
    const cap = depositTotal * 0.6;

    const paidSoFar = await Commission.aggregate([
      { $match: { partnerId: partner._id, clientId, type: "turnover" } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]);
    const paid = paidSoFar[0]?.total || 0;
    const remaining = cap - paid;
    if (remaining <= 0) return;

    const turnoverPct = partner.turnoverPct || 3;
    const earned = tradeAmount * (turnoverPct / 100);
    const actual = Math.min(earned, remaining);
    if (actual <= 0) return;

    await Commission.create({
      partnerId: partner._id,
      clientId,
      type: "turnover",
      amount: actual,
      calculatedFrom: tradeAmount,
    });

    await Partner.findByIdAndUpdate(partner._id, {
      $inc: { availableBalance: actual },
    });

    logger.info({ partnerId: partner._id, clientId, actual }, "Turnover commission credited");
  } catch (err) {
    logger.error({ err }, "Error processing turnover commission");
  }
}

export async function processCpaCommission(
  clientId: mongoose.Types.ObjectId,
  depositId: mongoose.Types.ObjectId
): Promise<void> {
  try {
    const client = await User.findById(clientId);
    if (!client || !client.partnerId) return;

    const partner = await Partner.findById(client.partnerId);
    if (!partner || partner.payoutModel !== "cpa") return;

    const existing = await Commission.findOne({
      partnerId: partner._id,
      clientId,
      type: "cpa",
    });
    if (existing) return;

    const cpaAmount = partner.cpaAmount || 5;
    await Commission.create({
      partnerId: partner._id,
      clientId,
      type: "cpa",
      amount: cpaAmount,
      depositId,
    });

    await Partner.findByIdAndUpdate(partner._id, {
      $inc: { availableBalance: cpaAmount, totalCommissionPaid: cpaAmount },
    });

    logger.info({ partnerId: partner._id, clientId, cpaAmount }, "CPA commission credited");
  } catch (err) {
    logger.error({ err }, "Error processing CPA commission");
  }
}
