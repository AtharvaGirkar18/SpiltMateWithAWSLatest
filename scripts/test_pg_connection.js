/**
 * PostgreSQL Connection Test Script
 * Tests connection and displays table structure
 */

require("dotenv").config();
const pgClient = require("../services/pgClient");

async function testConnection() {
  console.log("=".repeat(60));
  console.log("PostgreSQL Connection Test");
  console.log("=".repeat(60));

  try {
    console.log("\n📡 Connecting to PostgreSQL...");
    console.log(`   Host: ${process.env.DB_HOST || process.env.PG_HOST}`);
    console.log(
      `   Database: ${process.env.DB_NAME || process.env.PG_DATABASE}`
    );
    console.log(`   User: ${process.env.DB_USER || process.env.PG_USER}`);

    await pgClient.initPg();
    const pool = pgClient.getPool();

    console.log("\n✅ Connection successful!\n");

    // Test query
    const versionResult = await pool.query("SELECT version()");
    console.log("📊 PostgreSQL Version:");
    console.log(`   ${versionResult.rows[0].version.split(",")[0]}\n`);

    // List tables
    const tablesQuery = `
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `;
    const tablesResult = await pool.query(tablesQuery);

    console.log("📋 Tables in database:");
    tablesResult.rows.forEach((row) => {
      console.log(`   - ${row.table_name}`);
    });

    // Show table structures
    for (const table of tablesResult.rows) {
      const tableName = table.table_name;
      const columnsQuery = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1
        ORDER BY ordinal_position
      `;
      const columnsResult = await pool.query(columnsQuery, [tableName]);

      console.log(`\n📊 Structure of '${tableName}':`);
      columnsResult.rows.forEach((col) => {
        console.log(
          `   ${col.column_name.padEnd(20)} ${col.data_type.padEnd(15)} ${
            col.is_nullable === "NO" ? "NOT NULL" : "NULL"
          }`
        );
      });

      // Count records
      const countResult = await pool.query(`SELECT COUNT(*) FROM ${tableName}`);
      console.log(`   → ${countResult.rows[0].count} record(s)\n`);
    }

    console.log("=".repeat(60));
    console.log("✅ Test completed successfully!");
    console.log("=".repeat(60));

    process.exit(0);
  } catch (err) {
    console.error("\n❌ Connection failed!");
    console.error(`   Error: ${err.message}`);
    console.error("\n💡 Troubleshooting:");
    console.error(
      "   - Check your .env file has DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD"
    );
    console.error("   - Verify AWS RDS security group allows your IP");
    console.error("   - Ensure RDS instance is running");
    console.error(`\n   Full error: ${err.stack}`);
    process.exit(1);
  }
}

testConnection();
