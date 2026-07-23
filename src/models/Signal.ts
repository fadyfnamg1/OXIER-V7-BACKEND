import mongoose, { Document, Schema } from "mongoose";

export interface ISignal extends Document {
  symbol: string;
  direction: "buy" | "sell";
  timeframe: "1m" | "3m" | "5m";
  rsi: number;
  macd: number;
  macdSignal: number;
  strength: "weak" | "moderate" | "strong";
  entryPrice: number;
  generatedAt: Date;
  expiresAt: Date;
}

const SignalSchema = new Schema<ISignal>(
  {
    symbol: { type: String, required: true },
    direction: { type: String, enum: ["buy", "sell"], required: true },
    timeframe: { type: String, enum: ["1m", "3m", "5m"], required: true },
    rsi: { type: Number, required: true },
    macd: { type: Number, required: true },
    macdSignal: { type: Number, required: true },
    strength: { type: String, enum: ["weak", "moderate", "strong"], required: true },
    entryPrice: { type: Number, required: true },
    generatedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ISignal>("Signal", SignalSchema);
