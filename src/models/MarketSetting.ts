import mongoose, { Document, Schema } from "mongoose";

export interface IMarketSetting extends Document {
  symbol: string; // e.g. "BTCUSDT" — the real Binance trading pair
  baseAsset: string; // e.g. "BTC"
  displayName: string; // e.g. "BTC/USDT"
  payoutPct: number;
  isActive: boolean;
  category: "crypto" | "gold" | "forex";
  icon?: string; // icon URL (coincap / overrides)
  decimals: number;
  source: "binance" | "manual"; // manual = admin-added market not from Binance auto-sync
}

const MarketSettingSchema = new Schema<IMarketSetting>(
  {
    symbol: { type: String, required: true, unique: true },
    baseAsset: { type: String, required: true },
    displayName: { type: String, required: true },
    payoutPct: { type: Number, required: true, default: 80 },
    isActive: { type: Boolean, default: true },
    category: { type: String, enum: ["crypto", "gold", "forex"], default: "crypto" },
    icon: { type: String },
    decimals: { type: Number, default: 2 },
    source: { type: String, enum: ["binance", "manual"], default: "binance" },
  },
  { timestamps: true }
);

export default mongoose.model<IMarketSetting>("MarketSetting", MarketSettingSchema);
