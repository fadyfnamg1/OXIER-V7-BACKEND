import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { sendRejectionEmail } from "../services/email.service";
import { processCpaCommission } from "../services/commission.service";
import Transaction from "../models/Transaction";
import User from "../models/User";
import mongoose from "mongoose";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("finance", "admin"));

router.get("/pending", async (_req: AuthRequest, res: Response): Promise<void> => {
  const txs = await Transaction.find({ status: "pending" })
    .populate("userId", "firstName lastName email")
    .sort({ createdAt: -1 });
  res.json({ transactions: txs });
});

router.get("/summary", async (_req: AuthRequest, res: Response): Promise<void> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [approved, rejected, volume] = await Promise.all([
    Transaction.countDocuments({ status: "confirmed", processedAt: { $gte: today } }),
    Transaction.countDocuments({ status: "rejected", processedAt: { $gte: today } }),
    Transaction.aggregate([
      { $match: { status: "confirmed", processedAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
  ]);

  res.json({ approved, rejected, volume: volume[0]?.total || 0 });
});

router.patch("/transactions/:id/confirm", async (req: AuthRequest, res: Response): Promise<void> => {
  const tx = await Transaction.findById(req.params["id"]);
  if (!tx || tx.status !== "pending") { res.status(400).json({ error: "Invalid transaction" }); return; }

  await tx.updateOne({ status: "confirmed", processedBy: req.user!.id, processedAt: new Date() });

  if (tx.type === "deposit") {
    await User.findByIdAndUpdate(tx.userId, {
      $inc: { realBalance: tx.amount, bonusBalance: tx.bonusAmount || 0 },
    });
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

export default router;
