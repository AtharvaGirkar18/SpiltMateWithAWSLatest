/**
 * Reset helper to DROP all PostgreSQL tables created by the app.
 * Usage: set DB env vars (or rely on defaults) then run:
 *   node scripts/reset_pg.js
 *
 * This is a destructive operation. It will remove all normalized tables.
 */

// Load environment variables from .env when running this script directly
require("dotenv").config();
const { Pool } = require("pg");

(async function () {
  // Create pool directly without loading schema
  const pool = new Pool({
    host: process.env.DB_HOST || process.env.PG_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || process.env.PG_PORT || "5432", 10),
    database: process.env.DB_NAME || process.env.PG_DATABASE || "splitmate",
    user: process.env.DB_USER || process.env.PG_USER || "postgres",
    password: String(process.env.DB_PASSWORD || process.env.PG_PASSWORD || ""),
    ssl: {
      rejectUnauthorized: false,
    },
  });

  try {
    console.log("🗑️  Dropping all normalized tables...");

    // Drop tables in reverse order of dependencies (children first)
    await pool.query("DROP TABLE IF EXISTS payment_requests CASCADE;");
    await pool.query("DROP TABLE IF EXISTS expense_splits CASCADE;");
    await pool.query("DROP TABLE IF EXISTS expenses CASCADE;");
    await pool.query("DROP TABLE IF EXISTS group_members CASCADE;");
    await pool.query("DROP TABLE IF EXISTS groups CASCADE;");
    await pool.query("DROP TABLE IF EXISTS users CASCADE;");

    console.log("✅ All tables dropped successfully.");
    await pool.end();
    process.exit(0);
  } catch (err) {
    console.error(
      "❌ Failed to drop tables:",
      err && err.message ? err.message : err
    );
    await pool.end();
    process.exit(1);
  }
})();
