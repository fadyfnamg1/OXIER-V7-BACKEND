import { Router, Request, Response } from "express";
import Signal from "../models/Signal";
import MarketSetting from "../models/MarketSetting";
import { latestPrices } from "../services/prices.service";
import { authMiddleware } from "../middleware/auth.middleware";

const router = Router();
router.use(authMiddleware);

router.get("/latest", async (_req: Request, res: Response): Promise<void> => {
  const signals = await Signal.find({ expiresAt: { $gt: new Date() } })
    .sort({ generatedAt: -1 })
    .limit(50);
  res.json({ signals });
});

router.get("/markets", async (_req: Request, res: Response): Promise<void> => {
  const markets = await MarketSetting.find({ isActive: true });
  const marketsWithPrices = markets.map((m) => ({
    ...m.toObject(),
    currentPrice: latestPrices.get(m.symbol)?.price ?? null,
  }));
  res.json({ markets: marketsWithPrices });
});

export default router;
