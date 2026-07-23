import mongoose, { Document, Schema } from "mongoose";

export interface IMessage {
  from: string;
  text: string;
  timestamp: Date;
}

export interface ISupportTicket extends Document {
  userId: mongoose.Types.ObjectId;
  subject: string;
  status: "open" | "replied" | "closed";
  messages: IMessage[];
  assignedTo?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    from: { type: String, required: true },
    text: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false }
);

const SupportTicketSchema = new Schema<ISupportTicket>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    subject: { type: String, required: true },
    status: { type: String, enum: ["open", "replied", "closed"], default: "open" },
    messages: [MessageSchema],
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true }
);

export default mongoose.model<ISupportTicket>("SupportTicket", SupportTicketSchema);
