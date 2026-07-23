import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import User from "../models/User";

export interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
    email: string;
  };
}

export async function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "No token provided" });
    return;
  }

  const token = authHeader.split(" ")[1];
  const secret = process.env["JWT_SECRET"] || "default_secret";

  try {
    const decoded = jwt.verify(token, secret) as { id: string; role: string; email: string };
    const user = await User.findById(decoded.id).select("role email isSuspended");
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    if (user.isSuspended) {
      res.status(403).json({ error: "Account suspended" });
      return;
    }
    req.user = { id: decoded.id, role: user.role, email: user.email };
    next();
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
}
