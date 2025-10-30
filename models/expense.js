const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema({
  group: { type: String, ref: "Group", required: true }, // Changed to String
  description: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  paidBy: { type: String, ref: "User", required: true }, // Changed to String for Cognito UUIDs
  splitType: { type: String, enum: ["equal", "unequal"], default: "equal" },
  splits: [
    {
      user: { type: String, ref: "User" }, // Changed to String for Cognito UUIDs
      amount: Number,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Expense", expenseSchema);
