const mongoose = require("mongoose");

const paymentRequestSchema = new mongoose.Schema({
  group: { type: String, ref: "Group", required: true }, // Changed to String
  fromUser: {
    type: String, // Changed to String for Cognito UUIDs
    ref: "User",
    required: true,
  }, // who owes money (payer)
  toUser: { type: String, ref: "User", required: true }, // Changed to String for Cognito UUIDs (who is owed/payee)
  amount: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "paid", "not received"],
    default: "pending",
  },
  mode: { type: String, enum: ["online", "cash"], default: "online" },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("PaymentRequest", paymentRequestSchema);
