import rateLimit from "express-rate-limit";

/**
 * Strict limiter for sensitive auth flows (login, OTP verification,
 * password reset). These are brute-forceable secrets (6-digit OTP,
 * passwords) and financial-account access, so they get a much tighter
 * budget than general API traffic.
 */
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." },
});

/**
 * Looser limiter applied to all other API routes, mainly to blunt
 * scripted abuse/scraping rather than to protect a specific secret.
 */
export const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});

/**
 * Tight limiter for money-movement endpoints (deposit/withdraw requests),
 * separate from the general API limiter, so a compromised/scripted
 * client account can't hammer these specifically.
 */
export const financialActionLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down." },
});
