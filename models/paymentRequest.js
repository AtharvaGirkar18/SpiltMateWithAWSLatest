const mongoose = require("mongoose");

const paymentRequestSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
  fromUser: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  }, // who owes money (payer)
  toUser: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // who is owed (payee)
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
