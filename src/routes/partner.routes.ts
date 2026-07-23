import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { financialActionLimiter } from "../middleware/rate-limit.middleware";
import Partner from "../models/Partner";
import Commission from "../models/Commission";
import User from "../models/User";
import Transaction from "../models/Transaction";
import { v4 as uuidv4 } from "uuid";

const router = Router();

router.get("/check-code", async (req, res): Promise<void> => {
  const { code } = req.query;
  const partner = await Partner.findOne({ code: String(code) });
  if (!partner) { res.status(404).json({ error: "Invalid referral code" }); return; }
  res.json({ valid: true });
});

router.use(authMiddleware);
router.use(requireRole("partner", "admin"));

router.get("/dashboard", async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.user!.id);
  let partner = await Partner.findOne({ userId: req.user!.id });

  if (!partner && req.user!.role === "admin") {
    res.status(404).json({ error: "Not a partner" }); return;
  }
  if (!partner) { res.status(404).json({ error: "Partner profile not found" }); return; }

  const clients = await User.find({ partnerId: partner._id }).select("firstName lastName email createdAt");
  const totalDeposits = await Transaction.aggregate([
    { $match: { userId: { $in: clients.map(c => c._id) }, type: "deposit", status: "confirmed" } },
    { $group: { _id: null, total: { $sum: "$amount" } } },
  ]);

  res.json({
    partner,
    totalClients: clients.length,
    totalDeposits: totalDeposits[0]?.total || 0,
    availableBalance: partner.availableBalance,
    code: partner.code,
    inviteLink: `${process.env["FRONTEND_URL"] || ""}/join?ref=${partner.code}`,
  });
});

router.get("/clients", async (req: AuthRequest, res: Response): Promise<void> => {
  const partner = await Partner.findOne({ userId: req.user!.id });
  if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

  const clients = await User.find({ partnerId: partner._id }).select("firstName createdAt");

  const clientData = await Promise.all(
    clients.map(async (client) => {
      const deposits = await Transaction.aggregate([
        { $match: { userId: client._id, type: "deposit", status: "confirmed" } },
        { $group: { _id: null, total: { $sum: "$amount" } } },
      ]);

      const commissions = await Commission.aggregate([
        { $match: { partnerId: partner._id, clientId: client._id } },
        { $group: { _id: "$type", total: { $sum: "$amount" } } },
      ]);

      const totalDeposits = deposits[0]?.total || 0;
      const cap = totalDeposits * 0.6;
      const cpaPaid = commissions.find(c => c._id === "cpa")?.total || 0;
      const turnoverPaid = commissions.find(c => c._id === "turnover")?.total || 0;

      return {
        clientId: client._id,
        displayName: client.firstName,
        joinedAt: client.createdAt,
        totalDeposits,
        cap,
        cpaPaid,
        cpaPending: cpaPaid === 0 && totalDeposits > 0,
        turnoverEarned: turnoverPaid,
        capConsumed: cpaPaid + turnoverPaid,
        capRemaining: Math.max(0, cap - cpaPaid - turnoverPaid),
      };
    })
  );

  res.json({ clients: clientData });
});

router.get("/commissions", async (req: AuthRequest, res: Response): Promise<void> => {
  const partner = await Partner.findOne({ userId: req.user!.id });
  if (!partner) { res.status(404).json({ error: "Partner not found" }); return; }

  const commissions = await Commission.find({ partnerId: partner._id })
    .sort({ createdAt: -1 })
    .limit(100);
  res.json({ commissions });
});

router.post("/withdraw", financialActionLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  const { amount, method, walletAddress } = req.body;
  const amountNum = Number(amount);

  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    res.status(400).json({ error: "Invalid withdrawal amount" });
    return;
  }

  const partner = await Partner.findOneAndUpdate(
    { userId: req.user!.id, availableBalance: { $gte: amountNum } },
    { $inc: { availableBalance: -amountNum } },
    { new: true }
  );

  if (!partner) {
    res.status(400).json({ error: "Insufficient balance" });
    return;
  }

  res.json({ message: "Withdrawal requested" });
});

router.post("/create", requireRole("admin"), async (req: AuthRequest, res: Response): Promise<void> => {
  const { userId, payoutModel, cpaAmount, turnoverPct } = req.body;
  const code = uuidv4().slice(0, 8).toUpperCase();

  const partner = await Partner.create({ userId, code, payoutModel, cpaAmount, turnoverPct });
  await User.findByIdAndUpdate(userId, { role: "partner", partnerId: partner._id });

  res.json({ partner, inviteLink: `${process.env["FRONTEND_URL"] || ""}/join?ref=${code}` });
});

export default router;
