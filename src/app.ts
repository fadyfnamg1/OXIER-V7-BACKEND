import express, { type Express } from "express";
import cors from "cors";
import path from "path";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { generalLimiter } from "./middleware/rate-limit.middleware";

const app: Express = express();

// Required on Railway / any platform behind a reverse proxy or load
// balancer — without this, req.ip always resolves to the proxy's
// internal IP, which would silently break the partner anti-fraud
// device/IP check in auth.service.ts (every signup would look like
// it came from the same IP).
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use("/uploads", express.static(path.resolve(process.cwd(), "uploads")));

app.use("/api", generalLimiter, router);

export default app;
