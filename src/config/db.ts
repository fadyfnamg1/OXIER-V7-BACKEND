import mongoose from "mongoose";
import { logger } from "../lib/logger";

export async function connectDB(): Promise<void> {
  const uri = process.env["MONGODB_URI"];
  if (!uri) {
    // index.ts already validates this before main() runs, but this guard
    // stays in case connectDB is ever called from another entrypoint.
    throw new Error("MONGODB_URI environment variable is required but was not provided.");
  }
  try {
    await mongoose.connect(uri);
    logger.info("MongoDB connected");
  } catch (err) {
    logger.error({ err }, "MongoDB connection failed");
    process.exit(1);
  }
}
