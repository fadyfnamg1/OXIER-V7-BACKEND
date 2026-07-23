import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth.routes";
import tradeRouter from "./trade.routes";
import walletRouter from "./wallet.routes";
import adminRouter from "./admin.routes";
import financeRouter from "./finance.routes";
import supportRouter from "./support.routes";
import partnerRouter from "./partner.routes";
import signalsRouter from "./signals.routes";
import marketDataRouter from "./market-data.routes";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/trade", tradeRouter);
router.use("/wallet", walletRouter);
router.use("/admin", adminRouter);
router.use("/finance", financeRouter);
router.use("/support", supportRouter);
router.use("/partner", partnerRouter);
router.use("/signals", signalsRouter);
router.use("/market-data", marketDataRouter);

export default router;
