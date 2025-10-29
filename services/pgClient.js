const { Pool } = require("pg");

let pool;

async function initPg() {
  // Support both PG_* and DB_* env var conventions. Ensure password is a string or undefined
  const host =
    process.env.PG_HOST ||
    process.env.PGHOST ||
    process.env.DB_HOST ||
    process.env.DB_HOSTNAME ||
    "splitmate-db.c9yrubuuio83.us-east-1.rds.amazonaws.com";
  const port =
    process.env.PG_PORT ||
    process.env.PGPORT ||
    process.env.DB_PORT ||
    process.env.DBPORT ||
    5432;
  const database =
    process.env.PG_DATABASE ||
    process.env.PGDATABASE ||
    process.env.DB_NAME ||
    process.env.DB_DATABASE ||
    "splitmate";
  const user =
    process.env.PG_USER ||
    process.env.PGUSER ||
    process.env.DB_USER ||
    process.env.DBUSERNAME ||
    "postgres";
  let password =
    process.env.PG_PASSWORD ||
    process.env.PGPASSWORD ||
    process.env.DB_PASSWORD ||
    process.env.DB_PASSWORD ||
    undefined;
  if (password !== undefined && typeof password !== "string") {
    // coerce to string if possible
    try {
      password = String(password);
    } catch (e) {
      password = undefined;
    }
  }

  const config = {
    host,
    port: Number(port),
    database,
    user,
    // only include password when defined (and string) to avoid client SASL errors
    ...(password ? { password } : {}),
    ssl: { rejectUnauthorized: false },
  };

  pool = new Pool(config);

  // simple connection check
  await pool.query("SELECT 1");
  console.log("[PostgreSQL] Connection successful!");

  // Read and execute normalized schema from pgModels/schema.sql
  const fs = require("fs");
  const path = require("path");
  const schemaPath = path.join(__dirname, "..", "pgModels", "schema.sql");

  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, "utf8");
    console.log(
      "[PostgreSQL] Executing normalized schema from pgModels/schema.sql..."
    );
    await pool.query(schema);
    console.log(
      "[PostgreSQL] ✓ Normalized tables created (users, groups, group_members, expenses, expense_splits)"
    );
  } else {
    console.warn(
      "[PostgreSQL] Warning: pgModels/schema.sql not found, skipping table creation"
    );
  }

  console.log("[PostgreSQL] Postgres pool initialized and ready.\n");
}

function getPool() {
  if (!pool)
    throw new Error("Postgres pool not initialized. Call initPg() first.");
  return pool;
}

module.exports = { initPg, getPool };
