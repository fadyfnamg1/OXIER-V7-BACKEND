import mongoose, { Document, Schema } from "mongoose";

export interface ITransaction extends Document {
  userId: mongoose.Types.ObjectId;
  type: "deposit" | "withdrawal";
  method: string;
  amount: number;
  bonusAmount?: number;
  bonusPct?: number;
  walletAddress?: string;
  proofImageUrl?: string;
  status: "pending" | "confirmed" | "rejected";
  txId?: string;
  adminNote?: string;
  processedBy?: mongoose.Types.ObjectId;
  processedAt?: Date;
  createdAt: Date;
  expiresAt?: Date;
}

const TransactionSchema = new Schema<ITransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["deposit", "withdrawal"], required: true },
    method: { type: String, required: true },
    amount: { type: Number, required: true },
    bonusAmount: { type: Number, default: 0 },
    bonusPct: { type: Number, default: 0 },
    walletAddress: { type: String },
    proofImageUrl: { type: String },
    status: {
      type: String,
      enum: ["pending", "confirmed", "rejected"],
      default: "pending",
    },
    txId: { type: String },
    adminNote: { type: String },
    processedBy: { type: Schema.Types.ObjectId, ref: "User" },
    processedAt: { type: Date },
    expiresAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<ITransaction>("Transaction", TransactionSchema);
