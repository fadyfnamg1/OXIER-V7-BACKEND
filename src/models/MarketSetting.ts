import mongoose, { Document, Schema } from "mongoose";

export interface IMarketSetting extends Document {
  symbol: string; // e.g. "BTCUSDT" — the real trading pair symbol (Bybit spot)
  baseAsset: string; // e.g. "BTC"
  displayName: string; // e.g. "BTC/USDT"
  payoutPct: number;
  isActive: boolean;
  category: "crypto" | "gold" | "forex";
  icon?: string; // icon URL (coincap / overrides)
  decimals: number;
  source: "binance" | "bybit" | "manual"; // manual = admin-added market not from auto-sync; "binance" kept for legacy rows synced before the Bybit switch
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
    source: { type: String, enum: ["binance", "bybit", "manual"], default: "bybit" },
  },
  { timestamps: true }
);

export default mongoose.model<IMarketSetting>("MarketSetting", MarketSettingSchema);
