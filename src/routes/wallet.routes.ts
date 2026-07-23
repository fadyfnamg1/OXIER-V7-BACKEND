import { Router, Response, Request } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { financialActionLimiter } from "../middleware/rate-limit.middleware";
import { upload, getFileUrl } from "../services/storage.service";
import Transaction from "../models/Transaction";
import DepositMethod from "../models/DepositMethod";
import User from "../models/User";
import { v4 as uuidv4 } from "uuid";

const router = Router();

router.get("/methods", async (_req: Request, res: Response): Promise<void> => {
  const methods = await DepositMethod.find({ isActive: true });
  res.json({ methods });
});

router.use(authMiddleware);
router.use(requireRole("client"));

router.post(
  "/deposit",
  financialActionLimiter,
  upload.single("proof"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      // SECURITY: bonus percentage is intentionally NOT read from req.body.
      // It must only ever come from the admin-configured DepositMethod —
      // otherwise a client could submit bonusPct: 1000 and award
      // themselves an arbitrary bonus on confirmation.
      const { method, amount } = req.body;
      if (!req.file) { res.status(400).json({ error: "Proof screenshot required" }); return; }

      const depositMethod = await DepositMethod.findOne({ name: method, isActive: true });
      if (!depositMethod) { res.status(400).json({ error: "Invalid deposit method" }); return; }

      const amountNum = Number(amount);
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        res.status(400).json({ error: "Invalid deposit amount" });
        return;
      }
      if (amountNum < depositMethod.minAmount || amountNum > depositMethod.maxAmount) {
        res.status(400).json({ error: `Amount must be between ${depositMethod.minAmount} and ${depositMethod.maxAmount}` });
        return;
      }

      const bonusPctNum = depositMethod.defaultBonusPct || 0;
      const bonusAmount = amountNum * (bonusPctNum / 100);
      const proofImageUrl = getFileUrl(req.file.filename);
      const txId = uuidv4().slice(0, 8).toUpperCase();

      const tx = await Transaction.create({
        userId: req.user!.id,
        type: "deposit",
        method,
        amount: amountNum,
        bonusAmount,
        bonusPct: bonusPctNum,
        proofImageUrl,
        txId,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
      });

      res.json({ message: "Deposit request submitted", txId: tx.txId });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
    }
  }
);

router.post("/withdraw", financialActionLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { amount, method, walletAddress } = req.body;
    const amountNum = Number(amount);

    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      res.status(400).json({ error: "Invalid withdrawal amount" });
      return;
    }
    if (!method || typeof method !== "string") {
      res.status(400).json({ error: "Withdrawal method is required" });
      return;
    }

    // Atomically check-and-deduct in one query to prevent a race where
    // two simultaneous withdrawal requests both pass the balance check
    // before either deduction is applied.
    const updatedUser = await User.findOneAndUpdate(
      { _id: req.user!.id, realBalance: { $gte: amountNum } },
      { $inc: { realBalance: -amountNum } },
      { new: true }
    );

    if (!updatedUser) {
      res.status(400).json({ error: "Insufficient real balance" });
      return;
    }

    const txId = uuidv4().slice(0, 8).toUpperCase();
    await Transaction.create({
      userId: req.user!.id,
      type: "withdrawal",
      method,
      amount: amountNum,
      walletAddress,
      txId,
    });

    res.json({ message: "Withdrawal request submitted", txId });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed" });
  }
});

router.get("/transactions", async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 20, type } = req.query;
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (type) filter["type"] = type;

  const transactions = await Transaction.find(filter)
    .sort({ createdAt: -1 })
    .skip((Number(page) - 1) * Number(limit))
    .limit(Number(limit));

  const total = await Transaction.countDocuments(filter);
  res.json({ transactions, total });
});

export default router;
