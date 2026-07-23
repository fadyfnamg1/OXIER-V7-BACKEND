import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { connectDB } from "./config/db";
import { createWSServer, broadcast } from "./websocket/ws.server";
import { startPriceFeed, setBroadcast } from "./services/prices.service";
import { startSignalsEngine, setSignalBroadcast } from "./services/signals.service";
import { setTradeBroadcast } from "./services/trade.service";
import { seedMarkets } from "./seed";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// JWT_SECRET must always be explicitly set. The fallback used elsewhere in
// the codebase ("default_secret") exists only as a last-resort so imports
// don't crash — it must never actually be reached at runtime, since anyone
// who reads the source code could forge admin tokens against it.
if (!process.env["JWT_SECRET"] || process.env["JWT_SECRET"].length < 16) {
  throw new Error(
    "JWT_SECRET environment variable is required and must be at least 16 characters. " +
      "Generate one with: openssl rand -hex 64"
  );
}

if (!process.env["MONGODB_URI"]) {
  throw new Error("MONGODB_URI environment variable is required but was not provided.");
}

async function main(): Promise<void> {
  await connectDB();

  await seedMarkets();

  const server = http.createServer(app);

  createWSServer(server);

  setBroadcast(broadcast);
  setSignalBroadcast(broadcast);
  setTradeBroadcast(broadcast);

  startPriceFeed();
  startSignalsEngine();

  server.listen(port, () => {
    logger.info({ port }, "OXIER Server listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal startup error");
  process.exit(1);
});
