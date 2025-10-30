const mongoose = require("mongoose");

const groupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: String, // optional
  members: [{ type: String, ref: "User" }], // Changed to String for Cognito UUIDs
  expenses: [{ type: String, ref: "Expense" }], // Changed to String
  status: {
    type: String,
    enum: ["active", "ready_to_settle"],
    default: "active",
  },
  createdAt: { type: Date, default: Date.now },
  createdBy: {
    type: String, // Changed to String for Cognito UUIDs
    ref: "User",
    required: true,
  },
});

module.exports = mongoose.model("Group", groupSchema);
