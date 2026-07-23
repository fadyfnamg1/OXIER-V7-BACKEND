import { Router, Request, Response, type IRouter } from "express";
import { fetchKlines, getLiveMarkets, getTickerPrice } from "../services/prices.service";
import { logger } from "../lib/logger";

// No auth here on purpose — the chart (including the pre-login splash
// screen market list) needs this data before a user has a session.
const router: IRouter = Router();

const VALID_INTERVALS = new Set([
  "1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "3d", "1w", "1M",
]);
const SYMBOL_RE = /^[A-Z0-9]{3,20}$/;

router.get("/klines", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.query["symbol"] || "").toUpperCase();
  const interval = String(req.query["interval"] || "1m");
  const limitRaw = Number(req.query["limit"] || 1000);

  if (!SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "Invalid or missing symbol" });
    return;
  }
  if (!VALID_INTERVALS.has(interval)) {
    res.status(400).json({ error: "Invalid interval" });
    return;
  }
  // Clamp so a bad/hostile request can't ask for an unbounded amount of
  // history through the paginated path.
  const limit = Math.min(Math.max(Math.floor(limitRaw) || 1000, 1), 5000);

  try {
    const bars = await fetchKlines(symbol, interval, limit);
    res.json({ bars });
  } catch (err) {
    logger.warn({ err, symbol, interval, limit }, "klines proxy failed");
    res.status(502).json({ error: "Failed to fetch klines from upstream" });
  }
});

router.get("/ticker-price", async (req: Request, res: Response): Promise<void> => {
  const symbol = String(req.query["symbol"] || "").toUpperCase();
  if (!SYMBOL_RE.test(symbol)) {
    res.status(400).json({ error: "Invalid or missing symbol" });
    return;
  }

  const price = await getTickerPrice(symbol);
  if (price === null) {
    res.status(502).json({ error: "Failed to fetch ticker price from upstream" });
    return;
  }
  res.json({ symbol, price });
});

router.get("/live-markets", async (_req: Request, res: Response): Promise<void> => {
  const markets = await getLiveMarkets();
  res.json({ markets });
});

export default router;
