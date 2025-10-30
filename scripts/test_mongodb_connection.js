/**
 * Test MongoDB Atlas connection
 */

require("dotenv").config();
const mongoose = require("mongoose");

console.log("🔍 Testing MongoDB connection...");
console.log("MONGODB_URI:", process.env.MONGODB_URI);

mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ MongoDB connection successful!");
    console.log("📦 Database:", mongoose.connection.db.databaseName);
    mongoose.connection.close();
    process.exit(0);
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err.message);
    console.error("Full error:", err);
    process.exit(1);
  });
