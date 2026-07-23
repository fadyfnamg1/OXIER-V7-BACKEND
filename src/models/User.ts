import mongoose, { Document, Schema } from "mongoose";

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  passwordHash: string;
  isVerified: boolean;
  deviceId?: string;
  ip?: string;
  country?: string;
  createdAt: Date;
  role: "client" | "admin" | "finance" | "support" | "partner";
  walletType: "demo" | "real";
  demoBalance: number;
  realBalance: number;
  bonusBalance: number;
  partnerId?: mongoose.Types.ObjectId;
  partnerCode?: string;
  isSuspended: boolean;
  suspendReason?: string;
  balanceLog: Array<{ amount: number; reason: string; by: string; at: Date }>;
}

const UserSchema = new Schema<IUser>(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    passwordHash: { type: String, required: true },
    isVerified: { type: Boolean, default: false },
    deviceId: { type: String },
    ip: { type: String },
    country: { type: String },
    role: {
      type: String,
      enum: ["client", "admin", "finance", "support", "partner"],
      default: "client",
    },
    walletType: { type: String, enum: ["demo", "real"], default: "demo" },
    demoBalance: { type: Number, default: 10000 },
    realBalance: { type: Number, default: 0 },
    bonusBalance: { type: Number, default: 0 },
    partnerId: { type: Schema.Types.ObjectId, ref: "Partner" },
    partnerCode: { type: String },
    isSuspended: { type: Boolean, default: false },
    suspendReason: { type: String },
    balanceLog: [
      {
        amount: Number,
        reason: String,
        by: String,
        at: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model<IUser>("User", UserSchema);
