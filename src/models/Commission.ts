import mongoose, { Document, Schema } from "mongoose";

export interface ICommission extends Document {
  partnerId: mongoose.Types.ObjectId;
  clientId: mongoose.Types.ObjectId;
  type: "cpa" | "turnover";
  amount: number;
  calculatedFrom?: number;
  depositId?: mongoose.Types.ObjectId;
  paid: boolean;
  paidAt?: Date;
  createdAt: Date;
}

const CommissionSchema = new Schema<ICommission>(
  {
    partnerId: { type: Schema.Types.ObjectId, ref: "Partner", required: true },
    clientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: ["cpa", "turnover"], required: true },
    amount: { type: Number, required: true },
    calculatedFrom: { type: Number },
    depositId: { type: Schema.Types.ObjectId, ref: "Transaction" },
    paid: { type: Boolean, default: false },
    paidAt: { type: Date },
  },
  { timestamps: true }
);

export default mongoose.model<ICommission>("Commission", CommissionSchema);
