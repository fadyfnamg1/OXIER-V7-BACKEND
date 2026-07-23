import { Router, Request, Response } from "express";
import {
  registerUser,
  verifyOtp,
  resendOtp,
  loginUser,
  sendPasswordResetOtp,
  resetPassword,
  deleteAccount,
  getMe,
} from "../services/auth.service";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { authLimiter } from "../middleware/rate-limit.middleware";

const router = Router();

router.use(authLimiter);

router.post("/register", async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await registerUser({ ...req.body, ip: req.ip });
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Registration failed" });
  }
});

router.post("/verify-otp", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code } = req.body;
    const result = await verifyOtp(email, code);
    res.json(result);
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "OTP verification failed" });
  }
});

router.post("/resend-otp", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "Email is required" }); return; }
    await resendOtp(email);
    res.json({ message: "A new verification code has been sent to your email." });
  } catch (err: unknown) {
    res.status(429).json({ error: err instanceof Error ? err.message : "Failed to resend OTP" });
  }
});

router.post("/login", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    const result = await loginUser(email, password);
    res.json(result);
  } catch (err: unknown) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Login failed" });
  }
});

router.post("/forgot-password", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email } = req.body;
    await sendPasswordResetOtp(email);
    res.json({ message: "If the email exists, an OTP has been sent." });
  } catch {
    res.json({ message: "If the email exists, an OTP has been sent." });
  }
});

router.post("/reset-password", async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, code, newPassword } = req.body;
    await resetPassword(email, code, newPassword);
    res.json({ message: "Password reset successfully" });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Reset failed" });
  }
});

router.delete("/delete-account", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { password, code } = req.body;
    await deleteAccount(req.user!.id, password, code);
    res.json({ message: "Account deleted" });
  } catch (err: unknown) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Deletion failed" });
  }
});

router.post("/send-delete-otp", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    await sendPasswordResetOtp(req.user!.email);
    res.json({ message: "OTP sent" });
  } catch {
    res.status(500).json({ error: "Failed to send OTP" });
  }
});

router.get("/me", authMiddleware, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = await getMe(req.user!.id);
    res.json(user);
  } catch (err: unknown) {
    res.status(404).json({ error: err instanceof Error ? err.message : "User not found" });
  }
});

export default router;
