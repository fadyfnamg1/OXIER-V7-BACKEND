import mongoose, { Document, Schema } from "mongoose";

export interface IDepositMethod extends Document {
  name: string;
  type: "wallet" | "crypto";
  walletNumber?: string;
  walletAddress?: string;
  isActive: boolean;
  country?: string;
  minAmount: number;
  maxAmount: number;
  currency: string;
  defaultBonusPct: number;
}

const DepositMethodSchema = new Schema<IDepositMethod>(
  {
    name: { type: String, required: true },
    type: { type: String, enum: ["wallet", "crypto"], required: true },
    walletNumber: { type: String },
    walletAddress: { type: String },
    isActive: { type: Boolean, default: true },
    country: { type: String },
    minAmount: { type: Number, default: 10 },
    maxAmount: { type: Number, default: 10000 },
    currency: { type: String, default: "USD" },
    // Bonus percentage applied to deposits using this method. Set and
    // controlled exclusively by the admin — never trust a client-supplied
    // bonus percentage (see wallet.routes.ts).
    defaultBonusPct: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IDepositMethod>("DepositMethod", DepositMethodSchema);
