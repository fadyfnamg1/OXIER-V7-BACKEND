import mongoose, { Document, Schema } from "mongoose";

export interface IOtpCode extends Document {
  email: string;
  code: string;
  expiresAt: Date;
  used: boolean;
}

const OtpCodeSchema = new Schema<IOtpCode>(
  {
    email: { type: String, required: true, lowercase: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    used: { type: Boolean, default: false },
  },
  { timestamps: true }
);

OtpCodeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model<IOtpCode>("OtpCode", OtpCodeSchema);
