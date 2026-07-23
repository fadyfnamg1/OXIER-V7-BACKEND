import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { openTrade, earlyCloseTrade, settleTradeWithClientPrice } from "../services/trade.service";
import Trade from "../models/Trade";
import User from "../models/User";

const router = Router();
router.use(authMiddleware);
router.use(requireRole("client"));

router.post("/open", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { marketSymbol, side, amount, expirySeconds, entryPrice } = req.body;
    if (entryPrice === undefined || entryPrice === null) {
      res.status(400).json({ error: "entryPrice is required" });
      return;
    }
    const user = await User.findById(req.user!.id).select("walletType");
    const result = await openTrade({
      userId: req.user!.id,
      marketSymbol,
      side,
      amount: Number(amount),
      expirySeconds: Number(expirySeconds),
      walletType: user?.walletType || "demo",
      entryPrice: Number(entryPrice),
    });
    res.json({ trade: result.trade });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to open trade" });
  }
});

// Flutter calls this when its local timer fires, providing the current price
// from its direct Binance connection. The server uses this price to settle the
// trade, then falls back to its own resolve if the client never calls.
router.post("/settle/:tradeId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { exitPrice } = req.body;
    await settleTradeWithClientPrice(req.params["tradeId"]!, req.user!.id, Number(exitPrice));
    res.json({ message: "Trade settled" });
  } catch (err: unknown) {
    // Don't expose internals — the trade will still be settled by the server timer
    res.status(400).json({ error: err instanceof Error ? err.message : "Settlement failed" });
  }
});

router.post("/close-early/:tradeId", async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await earlyCloseTrade(req.params["tradeId"]!, req.user!.id);
    res.json({ message: "Trade closed early — 50% refunded" });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Failed to close trade" });
  }
});

router.get("/history", async (req: AuthRequest, res: Response): Promise<void> => {
  const { page = 1, limit = 20, status } = req.query;
  const filter: Record<string, unknown> = { userId: req.user!.id };
  if (status) filter["status"] = status;
  const trades = await Trade.find(filter).sort({ openedAt: -1 })
    .skip((Number(page) - 1) * Number(limit)).limit(Number(limit));
  const total = await Trade.countDocuments(filter);
  res.json({ trades, total, page: Number(page) });
});

router.get("/active", async (req: AuthRequest, res: Response): Promise<void> => {
  const trades = await Trade.find({ userId: req.user!.id, status: "open" });
  res.json({ trades });
});

router.post("/switch-wallet", async (req: AuthRequest, res: Response): Promise<void> => {
  const { walletType } = req.body;
  if (!["demo", "real"].includes(walletType)) {
    res.status(400).json({ error: "Invalid wallet type" }); return;
  }
  await User.findByIdAndUpdate(req.user!.id, { walletType });
  res.json({ message: `Switched to ${walletType} wallet` });
});

router.get("/balance", async (req: AuthRequest, res: Response): Promise<void> => {
  const user = await User.findById(req.user!.id).select("demoBalance realBalance bonusBalance walletType");
  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json({ demoBalance: user.demoBalance, realBalance: user.realBalance, bonusBalance: user.bonusBalance, walletType: user.walletType });
});

export default router;
