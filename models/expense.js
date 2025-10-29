const mongoose = require("mongoose");

const expenseSchema = new mongoose.Schema({
  group: { type: mongoose.Schema.Types.ObjectId, ref: "Group", required: true },
  description: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  paidBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  splitType: { type: String, enum: ["equal", "unequal"], default: "equal" },
  splits: [
    {
      user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      amount: Number,
    },
  ],
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Expense", expenseSchema);
