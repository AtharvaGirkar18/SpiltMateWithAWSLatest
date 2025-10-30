require("dotenv").config();
const mongoose = require("mongoose");
const { Pool } = require("pg");

const User = require("../models/user");
const Group = require("../models/group");
const Expense = require("../models/expense");
const PaymentRequest = require("../models/paymentRequest");

async function resetBothDatabases() {
  let mongoConnection = null;
  let pgPool = null;

  try {
    console.log("🔥 COMPLETE DATABASE RESET - MongoDB + PostgreSQL\n");
    console.log("⚠️  WARNING: This will delete ALL data from BOTH databases!");
    console.log("\n🔄 Starting in 3 seconds...\n");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // ============= Reset MongoDB =============
    console.log("📦 [MongoDB] Connecting...");
    await mongoose.connect(process.env.MONGODB_URI);
    mongoConnection = mongoose.connection;
    console.log("✅ [MongoDB] Connected\n");

    console.log("🗑️  [MongoDB] Deleting collections...");
    const userResult = await User.deleteMany({});
    console.log(`   ✅ Deleted ${userResult.deletedCount} users`);

    const groupResult = await Group.deleteMany({});
    console.log(`   ✅ Deleted ${groupResult.deletedCount} groups`);

    const expenseResult = await Expense.deleteMany({});
    console.log(`   ✅ Deleted ${expenseResult.deletedCount} expenses`);

    const paymentResult = await PaymentRequest.deleteMany({});
    console.log(`   ✅ Deleted ${paymentResult.deletedCount} payment requests`);

    console.log("✅ [MongoDB] Reset complete!\n");

    // ============= Reset PostgreSQL =============
    console.log("🐘 [PostgreSQL] Connecting...");
    pgPool = new Pool({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT,
      database: process.env.DB_NAME,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: {
        rejectUnauthorized: false, // Required for AWS RDS
      },
    });
    await pgPool.query("SELECT 1");
    console.log("✅ [PostgreSQL] Connected\n");

    console.log(
      "🗑️  [PostgreSQL] Deleting tables (respecting foreign keys)..."
    );

    const expenseSplitsResult = await pgPool.query(
      "DELETE FROM expense_splits"
    );
    console.log(`   ✅ Deleted ${expenseSplitsResult.rowCount} expense splits`);

    const expensesResult = await pgPool.query("DELETE FROM expenses");
    console.log(`   ✅ Deleted ${expensesResult.rowCount} expenses`);

    const groupMembersResult = await pgPool.query("DELETE FROM group_members");
    console.log(`   ✅ Deleted ${groupMembersResult.rowCount} group members`);

    const groupsResult = await pgPool.query("DELETE FROM groups");
    console.log(`   ✅ Deleted ${groupsResult.rowCount} groups`);

    const usersResult = await pgPool.query("DELETE FROM users");
    console.log(`   ✅ Deleted ${usersResult.rowCount} users`);

    console.log("✅ [PostgreSQL] Reset complete!\n");

    console.log("🎉 ================================");
    console.log("🎉 COMPLETE RESET SUCCESSFUL!");
    console.log("🎉 ================================\n");

    console.log("📝 Next steps:");
    console.log("   1. Start your app: npm start");
    console.log("   2. Sign up with AWS Cognito");
    console.log("   3. Create groups and add expenses");
    console.log(
      "   4. Everything will sync to both databases automatically!\n"
    );
  } catch (error) {
    console.error("\n❌ Error during reset:", error.message);
    process.exit(1);
  } finally {
    if (mongoConnection) {
      await mongoConnection.close();
      console.log("🔌 MongoDB connection closed");
    }
    if (pgPool) {
      await pgPool.end();
      console.log("🔌 PostgreSQL connection closed");
    }
    process.exit(0);
  }
}

resetBothDatabases();
