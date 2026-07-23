import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import SupportTicket from "../models/SupportTicket";
import User from "../models/User";
import Trade from "../models/Trade";
import Transaction from "../models/Transaction";

const router = Router();
router.use(authMiddleware);

router.post("/tickets", requireRole("client"), async (req: AuthRequest, res: Response): Promise<void> => {
  const { subject, message } = req.body;
  const user = await User.findById(req.user!.id).select("firstName lastName");
  const ticket = await SupportTicket.create({
    userId: req.user!.id,
    subject,
    messages: [{ from: user ? `${user.firstName} ${user.lastName}` : req.user!.email, text: message, timestamp: new Date() }],
  });
  res.json({ ticket });
});

router.get("/tickets", requireRole("client"), async (req: AuthRequest, res: Response): Promise<void> => {
  const tickets = await SupportTicket.find({ userId: req.user!.id }).sort({ updatedAt: -1 });
  res.json({ tickets });
});

router.get("/inbox", requireRole("support", "admin"), async (_req: AuthRequest, res: Response): Promise<void> => {
  const tickets = await SupportTicket.find()
    .populate("userId", "firstName lastName email")
    .sort({ updatedAt: -1 });
  res.json({ tickets });
});

router.get("/tickets/:id", requireRole("support", "admin", "client"), async (req: AuthRequest, res: Response): Promise<void> => {
  const ticket = await SupportTicket.findById(req.params["id"]).populate("userId", "firstName lastName email");
  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

  const clientId = (ticket.userId as unknown as { _id: string })._id?.toString() || ticket.userId.toString();
  if (req.user!.role === "client" && clientId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" }); return;
  }

  const [recentTrades, recentTx] = await Promise.all([
    Trade.find({ userId: ticket.userId }).sort({ openedAt: -1 }).limit(5),
    Transaction.find({ userId: ticket.userId }).sort({ createdAt: -1 }).limit(5),
  ]);

  const userInfo = await User.findById(ticket.userId).select("firstName lastName email demoBalance realBalance");
  res.json({ ticket, userInfo, recentTrades, recentTx });
});

router.post("/tickets/:id/reply", requireRole("support", "admin"), async (req: AuthRequest, res: Response): Promise<void> => {
  const { text } = req.body;
  const ticket = await SupportTicket.findByIdAndUpdate(
    req.params["id"],
    { $push: { messages: { from: "Support", text, timestamp: new Date() } }, status: "replied" },
    { new: true }
  );
  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }
  res.json({ ticket });
});

router.post("/tickets/:id/close", requireRole("support", "admin"), async (req: AuthRequest, res: Response): Promise<void> => {
  await SupportTicket.findByIdAndUpdate(req.params["id"], { status: "closed" });
  res.json({ message: "Ticket closed" });
});

router.post("/tickets/:id/message", requireRole("client"), async (req: AuthRequest, res: Response): Promise<void> => {
  const { text } = req.body;
  const user = await User.findById(req.user!.id).select("firstName lastName");
  const ticket = await SupportTicket.findOne({ _id: req.params["id"], userId: req.user!.id });
  if (!ticket) { res.status(404).json({ error: "Ticket not found" }); return; }

  ticket.messages.push({ from: user ? `${user.firstName} ${user.lastName}` : req.user!.email, text, timestamp: new Date() });
  ticket.status = "open";
  await ticket.save();
  res.json({ ticket });
});

export default router;
