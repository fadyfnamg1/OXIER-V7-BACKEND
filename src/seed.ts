import User from "./models/User";
import bcrypt from "bcryptjs";
import { logger } from "./lib/logger";
import { syncMarketsFromBybit } from "./services/prices.service";

/**
 * On boot: pull the real, live list of tradable pairs from Bybit
 * (instead of a hardcoded market list) and make sure a default admin
 * account exists.
 */
export async function seedMarkets(): Promise<void> {
  try {
    await syncMarketsFromBybit();

    const adminExists = await User.findOne({ role: "admin" });
    if (!adminExists) {
      const adminPassword = process.env["ADMIN_PASSWORD"] || "Admin@123456";
      const passwordHash = await bcrypt.hash(adminPassword, 12);
      await User.create({
        firstName: "Admin",
        lastName: "OXIER",
        email: process.env["ADMIN_EMAIL"] || "admin@oxier.com",
        passwordHash,
        role: "admin",
        isVerified: true,
      });
      logger.info("Default admin created: admin@oxier.com / Admin@123456");
    }
  } catch (err) {
    logger.error({ err }, "Seed error");
  }
}
