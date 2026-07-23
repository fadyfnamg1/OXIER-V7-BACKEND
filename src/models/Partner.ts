import mongoose, { Document, Schema } from "mongoose";

export interface IPartner extends Document {
  userId: mongoose.Types.ObjectId;
  code: string;
  tier: "bronze" | "silver" | "gold" | "platinum" | "diamond";
  payoutModel: "cpa" | "turnover";
  cpaAmount: number;
  turnoverPct: number;
  totalClients: number;
  totalDeposits: number;
  totalCommissionPaid: number;
  availableBalance: number;
  createdAt: Date;
}

const PartnerSchema = new Schema<IPartner>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    code: { type: String, required: true, unique: true },
    tier: {
      type: String,
      enum: ["bronze", "silver", "gold", "platinum", "diamond"],
      default: "bronze",
    },
    payoutModel: { type: String, enum: ["cpa", "turnover"], default: "cpa" },
    cpaAmount: { type: Number, default: 5 },
    turnoverPct: { type: Number, default: 3 },
    totalClients: { type: Number, default: 0 },
    totalDeposits: { type: Number, default: 0 },
    totalCommissionPaid: { type: Number, default: 0 },
    availableBalance: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model<IPartner>("Partner", PartnerSchema);
