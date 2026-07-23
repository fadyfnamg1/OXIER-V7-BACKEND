import mongoose, { Document, Schema } from "mongoose";

export interface ITrade extends Document {
  userId: mongoose.Types.ObjectId;
  marketSymbol: string;
  marketName: string;
  side: "buy" | "sell";
  amount: number;
  entryPrice: number;
  exitPrice?: number;
  payoutPct: number;
  expirySeconds: number;
  openedAt: Date;
  expiryAt: Date;
  resolvedAt?: Date;
  status: "open" | "won" | "lost" | "closed_early";
  profit?: number;
  walletType: "demo" | "real";
}

const TradeSchema = new Schema<ITrade>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    marketSymbol: { type: String, required: true },
    marketName: { type: String, required: true },
    side: { type: String, enum: ["buy", "sell"], required: true },
    amount: { type: Number, required: true },
    entryPrice: { type: Number, required: true },
    exitPrice: { type: Number },
    payoutPct: { type: Number, required: true },
    expirySeconds: { type: Number, required: true },
    openedAt: { type: Date, default: Date.now },
    expiryAt: { type: Date, required: true },
    resolvedAt: { type: Date },
    status: {
      type: String,
      enum: ["open", "won", "lost", "closed_early"],
      default: "open",
    },
    profit: { type: Number },
    walletType: { type: String, enum: ["demo", "real"], required: true },
  },
  { timestamps: true }
);

export default mongoose.model<ITrade>("Trade", TradeSchema);
