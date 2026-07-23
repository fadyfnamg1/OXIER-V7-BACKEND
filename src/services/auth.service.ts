import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import User from "../models/User";
import OtpCode from "../models/OtpCode";
import Partner from "../models/Partner";
import { sendOtpEmail } from "./email.service";
import { logger } from "../lib/logger";

const JWT_SECRET = () => process.env["JWT_SECRET"] || "default_secret";

function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function registerUser(data: {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  deviceId?: string;
  ip?: string;
  country?: string;
  partnerCode?: string;
}): Promise<{ message: string }> {
  const existing = await User.findOne({ email: data.email.toLowerCase() });
  if (existing) throw new Error("Email already registered");

  let partnerId: string | undefined;
  let partnerCode: string | undefined;

  if (data.partnerCode) {
    const partner = await Partner.findOne({ code: data.partnerCode });

    if (partner) {
      const partnerUser = await User.findById(partner.userId);

      const sameDevice = Boolean(
        data.deviceId && partnerUser?.deviceId && data.deviceId === partnerUser.deviceId
      );
      const sameIp = Boolean(data.ip && partnerUser?.ip && data.ip === partnerUser.ip);

      const orConditions = [
        ...(data.deviceId ? [{ deviceId: data.deviceId }] : []),
        ...(data.ip ? [{ ip: data.ip }] : []),
      ];
      const deviceOrIpAlreadyUsedForThisPartner =
        orConditions.length > 0
          ? await User.findOne({ partnerId: partner._id, $or: orConditions })
          : null;

      if (sameDevice || sameIp) {
        logger.warn(
          { partnerCode: data.partnerCode, deviceId: data.deviceId, ip: data.ip },
          "Anti-fraud: blocked self-referral — device/IP matches partner's own account"
        );
        throw new Error(
          "This referral code cannot be used to register from this device. Self-referral is not allowed."
        );
      }

      if (deviceOrIpAlreadyUsedForThisPartner) {
        logger.warn(
          { partnerCode: data.partnerCode, deviceId: data.deviceId, ip: data.ip },
          "Anti-fraud: blocked duplicate device/IP referral under same partner"
        );
        throw new Error(
          "A client has already registered under this referral code from this device."
        );
      }

      partnerId = partner._id.toString();
      partnerCode = data.partnerCode;
    }
  }

  const passwordHash = await bcrypt.hash(data.password, 12);
  const user = new User({
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email.toLowerCase(),
    passwordHash,
    deviceId: data.deviceId,
    ip: data.ip,
    country: data.country,
    partnerId,
    partnerCode,
  });
  await user.save();

  const code = generateOtp();
  await OtpCode.create({
    email: data.email.toLowerCase(),
    code,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  await sendOtpEmail(data.email, code);
  logger.info({ email: data.email }, "OTP sent on register");

  return { message: "Registration successful. Check your email for the OTP." };
}

export async function verifyOtp(email: string, code: string): Promise<{ message: string }> {
  const otp = await OtpCode.findOne({
    email: email.toLowerCase(),
    code,
    used: false,
    expiresAt: { $gt: new Date() },
  });
  if (!otp) throw new Error("Invalid or expired OTP");

  await otp.updateOne({ used: true });
  await User.findOneAndUpdate({ email: email.toLowerCase() }, { isVerified: true });

  return { message: "Email verified successfully" };
}

export async function resendOtp(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase() });
  // Always silently succeed to prevent email enumeration
  if (!user || user.isVerified) return;

  // Rate-limit: only allow one resend every 60 seconds
  const recentOtp = await OtpCode.findOne({
    email: email.toLowerCase(),
    used: false,
    expiresAt: { $gt: new Date() },
    createdAt: { $gt: new Date(Date.now() - 60 * 1000) },
  });
  if (recentOtp) {
    throw new Error("Please wait 60 seconds before requesting a new code.");
  }

  const code = generateOtp();
  await OtpCode.create({
    email: email.toLowerCase(),
    code,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  await sendOtpEmail(email, code);
  logger.info({ email }, "OTP resent");
}

export async function loginUser(
  email: string,
  password: string
): Promise<{ token: string; user: object }> {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) throw new Error("Invalid credentials");
  if (!user.isVerified) throw new Error("Email not verified. Check your inbox for the OTP.");
  if (user.isSuspended) throw new Error("Account suspended. Contact support.");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error("Invalid credentials");

  const token = jwt.sign(
    { id: user._id, role: user.role, email: user.email },
    JWT_SECRET(),
    { expiresIn: "7d" }
  );

  return {
    token,
    user: {
      id: user._id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      role: user.role,
      walletType: user.walletType,
      demoBalance: user.demoBalance,
      realBalance: user.realBalance,
      bonusBalance: user.bonusBalance,
    },
  };
}

export async function sendPasswordResetOtp(email: string): Promise<void> {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return;

  const code = generateOtp();
  await OtpCode.create({
    email: email.toLowerCase(),
    code,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });
  await sendOtpEmail(email, code);
}

export async function resetPassword(
  email: string,
  code: string,
  newPassword: string
): Promise<void> {
  const otp = await OtpCode.findOne({
    email: email.toLowerCase(),
    code,
    used: false,
    expiresAt: { $gt: new Date() },
  });
  if (!otp) throw new Error("Invalid or expired OTP");

  await otp.updateOne({ used: true });
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await User.findOneAndUpdate({ email: email.toLowerCase() }, { passwordHash });
}

export async function deleteAccount(
  userId: string,
  password: string,
  code: string
): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new Error("Invalid password");

  const otp = await OtpCode.findOne({
    email: user.email,
    code,
    used: false,
    expiresAt: { $gt: new Date() },
  });
  if (!otp) throw new Error("Invalid or expired OTP");

  await otp.updateOne({ used: true });
  await User.findByIdAndDelete(userId);
}

export async function getMe(userId: string): Promise<object> {
  const user = await User.findById(userId);
  if (!user) throw new Error("User not found");

  return {
    id: user._id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
    role: user.role,
    walletType: user.walletType,
    demoBalance: user.demoBalance,
    realBalance: user.realBalance,
    bonusBalance: user.bonusBalance,
  };
}
