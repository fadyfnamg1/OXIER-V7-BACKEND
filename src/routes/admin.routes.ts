import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { sendRejectionEmail } from "../services/email.service";
import { processCpaCommission } from "../services/commission.service";
import User from "../models/User";
import Trade from "../models/Trade";
import Transaction from "../models/Transaction";
import MarketSetting from "../models/MarketSetting";
import DepositMethod from "../models/DepositMethod";
import Partner from "../models/Partner";
import Commission from "../models/Commission";
import SupportTicket from "../models/SupportTicket";
import mongoose from "mongoose";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("admin"));

router.get("/dashboard", async (_req: AuthRequest, res: Response): Promise<void> => {
  const [
    totalUsers,
    activeToday,
    newToday,
    openTrades,
    totalDeposited,
    totalWithdrawn,
    platformProfit,
    dailyProfit,
  ] = await Promise.all([
    User.countDocuments({ role: "client" }),
    User.countDocuments({ updatedAt: { $gte: new Date(Date.now() - 86400000) } }),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 86400000) } }),
    Trade.countDocuments({ status: "open" }),
    Transaction.aggregate([{ $match: { type: "deposit", status: "confirmed" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    Transaction.aggregate([{ $match: { type: "withdrawal", status: "confirmed" } }, { $group: { _id: null, total: { $sum: "$amount" } } }]),
    Trade.aggregate([
      { $match: { status: { $in: ["won", "lost"] }, walletType: "real" } },
      { $group: { _id: null, profit: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, "$amount", { $multiply: ["$profit", -1] }] } } } },
    ]),
    Trade.aggregate([
      { $match: { walletType: "real", openedAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$openedAt" } }, profit: { $sum: { $cond: [{ $eq: ["$status", "lost"] }, "$amount", { $multiply: ["$profit", -1] }] } } } },
      { $sort: { _id: 1 } },
    ]),
  ]);

  res.json({
    totalUsers,
    activeToday,
    newToday,
    openTrades,
    totalDeposited: totalDeposited[0]?.total || 0,
    totalWithdrawn: totalWithdrawn[0]?.total || 0,
    platformProfit: platformProfit[0]?.profit || 0,
    dailyProfit,
  });
});

router.get("/users", async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 20, search, country, status } = req.query;
  const filter: Record<string, unknown> = { role: "client" };
  if (search) filter["$or"] = [{ email: new RegExp(String(search), "i") }, { firstName: new RegExp(String(search), "i") }];
  if (country) filter["country"] = country;
  if (status === "suspended") filter["isSuspended"] = true;

  const users = await User.find(filter)
    .select("-passwordHash")
    .sort({ createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit));

  const total = await User.countDocuments(filter);
  res.json({ users, total });
});

router.get("/users/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.params["id"]).select("-passwordHash");
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const [trades, transactions] = await Promise.all([
    Trade.find({ userId: req.params["id"] }).sort({ openedAt: -1 }).limit(50),
    Transaction.find({ userId: req.params["id"] }).sort({ createdAt: -1 }).limit(50),
  ]);

  res.json({ user, trades, transactions });
});

router.patch("/users/:id/balance", async (req: AuthRequest, res: Response): Promise<void> => {
  const { amount, reason, walletType = "real" } = req.body;
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum === 0) {
    res.status(400).json({ error: "Amount must be a non-zero number" });
    return;
  }
  if (!reason || typeof reason !== "string") {
    res.status(400).json({ error: "A reason is required for balance adjustments" });
    return;
  }

  const user = await User.findById(req.params["id"]);
  if (!user) { res.status(404).json({ error: "User not found" }); return; }

  const field = walletType === "demo" ? "demoBalance" : walletType === "bonus" ? "bonusBalance" : "realBalance";
  await User.findByIdAndUpdate(req.params["id"], {
    $inc: { [field]: amountNum },
    $push: { balanceLog: { amount: amountNum, reason, by: req.user!.id, at: new Date() } },
  });
  res.json({ message: "Balance updated" });
});

router.patch("/users/:id/suspend", async (req: AuthRequest, res: Response): Promise<void> => {
  const { suspend, reason } = req.body;
  await User.findByIdAndUpdate(req.params["id"], { isSuspended: suspend, suspendReason: reason });
  res.json({ message: suspend ? "Account suspended" : "Account reactivated" });
});

router.get("/markets", async (_req: AuthRequest, res: Response): Promise<void> => {
  const markets = await MarketSetting.find().sort({ symbol: 1 });
  res.json({ markets });
});

router.patch("/markets/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const market = await MarketSetting.findByIdAndUpdate(req.params["id"], req.body, { new: true });
  if (!market) { res.status(404).json({ error: "Market not found" }); return; }
  res.json({ market });
});

router.post("/markets", async (req: AuthRequest, res: Response): Promise<void> => {
  const market = await MarketSetting.create(req.body);
  res.json({ market });
});

router.get("/deposit-methods", async (_req: AuthRequest, res: Response): Promise<void> => {
  const methods = await DepositMethod.find();
  res.json({ methods });
});

router.post("/deposit-methods", async (req: AuthRequest, res: Response): Promise<void> => {
  const method = await DepositMethod.create(req.body);
  res.json({ method });
});

router.patch("/deposit-methods/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const method = await DepositMethod.findByIdAndUpdate(req.params["id"], req.body, { new: true });
  res.json({ method });
});

router.delete("/deposit-methods/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  await DepositMethod.findByIdAndDelete(req.params["id"]);
  res.json({ message: "Deleted" });
});

router.get("/transactions", async (req: AuthRequest, res: Response): Promise<void> => {
  const { status = "pending", type, page = 1, limit = 20 } = req.query;
  const filter: Record<string, unknown> = {};
  if (status) filter["status"] = status;
  if (type) filter["type"] = type;

  const txs = await Transaction.find(filter)
    .populate("userId", "firstName lastName email")
    .sort({ createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit));

  const total = await Transaction.countDocuments(filter);
  res.json({ transactions: txs, total });
});

router.patch("/transactions/:id/confirm", async (req: AuthRequest, res: Response): Promise<void> => {
  const tx = await Transaction.findById(req.params["id"]);
  if (!tx || tx.status !== "pending") { res.status(400).json({ error: "Invalid transaction" }); return; }

  await tx.updateOne({ status: "confirmed", processedBy: req.user!.id, processedAt: new Date() });

  if (tx.type === "deposit") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { realBalance: tx.amount, bonusBalance: tx.bonusAmount || 0 } });
    await processCpaCommission(tx.userId as mongoose.Types.ObjectId, tx._id as mongoose.Types.ObjectId);
  }
  res.json({ message: "Confirmed" });
});

router.patch("/transactions/:id/reject", async (req: AuthRequest, res: Response): Promise<void> => {
  const { note } = req.body;
  const tx = await Transaction.findById(req.params["id"]).populate<{ userId: { email: string } }>("userId", "email");
  if (!tx || tx.status !== "pending") { res.status(400).json({ error: "Invalid transaction" }); return; }

  await tx.updateOne({ status: "rejected", adminNote: note, processedBy: req.user!.id, processedAt: new Date() });

  if (tx.type === "withdrawal") {
    await User.findByIdAndUpdate(tx.userId, { $inc: { realBalance: tx.amount } });
  }

  const userEmail = (tx.userId as unknown as { email?: string } | null)?.email;
  if (userEmail) await sendRejectionEmail(userEmail, note || "No reason provided", tx.txId || "");
  res.json({ message: "Rejected" });
});

router.get("/partners", async (_req: AuthRequest, res: Response): Promise<void> => {
  const partners = await Partner.find().populate("userId", "firstName lastName email");
  res.json({ partners });
});

router.patch("/partners/:id", async (req: AuthRequest, res: Response): Promise<void> => {
  const partner = await Partner.findByIdAndUpdate(req.params["id"], req.body, { new: true });
  res.json({ partner });
});

router.post("/partners/:id/pay-commission", async (req: AuthRequest, res: Response): Promise<void> => {
  const amountNum = Number(req.body.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ error: "Invalid commission amount" });
    return;
  }

  const partner = await Partner.findOneAndUpdate(
    { _id: req.params["id"], availableBalance: { $gte: amountNum } },
    { $inc: { availableBalance: -amountNum, totalCommissionPaid: amountNum } },
    { new: true }
  );
  if (!partner) { res.status(400).json({ error: "Insufficient balance" }); return; }

  await Commission.updateMany({ partnerId: partner._id, paid: false }, { paid: true, paidAt: new Date() });

  res.json({ message: "Commission paid" });
});

router.get("/analytics", async (_req: AuthRequest, res: Response): Promise<void> => {
  const [tradeVolume, winRate, topDepositors, topPartners] = await Promise.all([
    Trade.aggregate([
      { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$openedAt" } }, volume: { $sum: "$amount" }, count: { $sum: 1 } } },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ]),
    Trade.aggregate([
      { $match: { status: { $in: ["won", "lost"] } } },
      { $group: { _id: "$marketSymbol", wins: { $sum: { $cond: [{ $eq: ["$status", "won"] }, 1, 0] } }, total: { $sum: 1 } } },
      { $project: { winRate: { $multiply: [{ $divide: ["$wins", "$total"] }, 100] }, total: 1 } },
    ]),
    Transaction.aggregate([
      { $match: { type: "deposit", status: "confirmed" } },
      { $group: { _id: "$userId", total: { $sum: "$amount" } } },
      { $sort: { total: -1 } },
      { $limit: 10 },
      { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "user" } },
      { $unwind: "$user" },
      { $project: { total: 1, "user.firstName": 1, "user.lastName": 1, "user.email": 1 } },
    ]),
    Partner.find().sort({ totalCommissionPaid: -1 }).limit(10).populate("userId", "firstName lastName"),
  ]);

  res.json({ tradeVolume, winRate, topDepositors, topPartners });
});

export default router;
