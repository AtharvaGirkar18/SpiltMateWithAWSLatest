/**
 * Bulk-sync script: copies all Users, Groups and Expenses from MongoDB into Postgres.
 * Usage (PowerShell):
 *   $env:MONGODB_URI='...'; $env:DB_PASSWORD='...'; node scripts/bulk_sync_pg.js
 * The script uses existing `services/pgClient` and `services/pgSync` upsert logic.
 */

require("dotenv").config();
const mongoose = require("mongoose");
const pgClient = require("../services/pgClient");
const pgSync = require("../services/pgSync");

const User = require("../models/user");
const Group = require("../models/group");
const Expense = require("../models/expense");

async function main() {
  const mongoUri =
    process.env.MONGODB_URI || "mongodb://localhost:27017/splitmate";
  console.log("Connecting to MongoDB:", mongoUri);
  await mongoose.connect(mongoUri, { autoIndex: false });

  try {
    await pgClient.initPg();
  } catch (err) {
    console.error(
      "Failed to initialize Postgres:",
      err && err.message ? err.message : err
    );
    process.exitCode = 1;
    return;
  }

  try {
    console.log("Fetching users from Mongo...");
    const users = await User.find().lean();
    console.log(`Found ${users.length} users — syncing...`);
    for (const u of users) {
      try {
        await pgSync.syncUser(u);
      } catch (e) {
        console.warn(
          "Failed to sync user",
          u._id || u.id,
          e && e.message ? e.message : e
        );
      }
    }

    console.log("Fetching groups from Mongo...");
    const groups = await Group.find().lean();
    console.log(`Found ${groups.length} groups — syncing...`);
    for (const g of groups) {
      try {
        await pgSync.syncGroup(g);
      } catch (e) {
        console.warn(
          "Failed to sync group",
          g._id || g.id,
          e && e.message ? e.message : e
        );
      }
    }

    console.log("Fetching expenses from Mongo...");
    const expenses = await Expense.find().lean();
    console.log(`Found ${expenses.length} expenses — syncing...`);
    for (const ex of expenses) {
      try {
        await pgSync.syncExpense(ex);
      } catch (e) {
        console.warn(
          "Failed to sync expense",
          ex._id || ex.id,
          e && e.message ? e.message : e
        );
      }
    }

    console.log("Bulk sync complete.");
  } catch (err) {
    console.error("Bulk sync failed:", err && err.message ? err.message : err);
  } finally {
    try {
      await mongoose.disconnect();
    } catch (e) {}
    process.exit();
  }
}

main().catch((e) => {
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
});
