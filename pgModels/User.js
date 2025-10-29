/**
 * PostgreSQL User Model
 * Normalized table with proper relationships
 */

const pgClient = require("../services/pgClient");

const UserModel = {
  tableName: "users",

  /**
   * Create or update a user
   */
  async upsert(userData) {
    const pool = pgClient.getPool();
    const query = `
      INSERT INTO users (mongo_id, first_name, last_name, email, password, profile_pic_url, profile_pic_key, phone, upi_link, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (mongo_id) 
      DO UPDATE SET
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        email = EXCLUDED.email,
        password = EXCLUDED.password,
        profile_pic_url = EXCLUDED.profile_pic_url,
        profile_pic_key = EXCLUDED.profile_pic_key,
        phone = EXCLUDED.phone,
        upi_link = EXCLUDED.upi_link,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, mongo_id
    `;

    const values = [
      userData.mongo_id,
      userData.first_name,
      userData.last_name,
      userData.email,
      userData.password,
      userData.profile_pic_url || null,
      userData.profile_pic_key || null,
      userData.phone,
      userData.upi_link,
      userData.created_at || new Date(),
    ];

    console.log("\n" + "=".repeat(80));
    console.log(`[PostgreSQL] 📝 USER SYNC - ${userData.email}`);
    console.log("=".repeat(80));
    console.log(`[PostgreSQL] SQL Query:`);
    console.log(query.trim());
    console.log(`\n[PostgreSQL] Values:`);
    console.log(`  mongo_id: ${values[0]}`);
    console.log(`  first_name: ${values[1]}`);
    console.log(`  last_name: ${values[2]}`);
    console.log(`  email: ${values[3]}`);
    console.log(`  phone: ${values[7]}`);
    console.log(`  upi_link: ${values[8]}`);

    const result = await pool.query(query, values);
    console.log(
      `\n[PostgreSQL] ✓ SUCCESS - User inserted/updated (PG id: ${result.rows[0].id})`
    );
    console.log("=".repeat(80) + "\n");

    return result.rows[0];
  },

  /**
   * Find user by mongo_id
   */
  async findByMongoId(mongoId) {
    const pool = pgClient.getPool();
    const query = `SELECT * FROM users WHERE mongo_id = $1`;
    const result = await pool.query(query, [mongoId]);
    return result.rows[0] || null;
  },

  /**
   * Get internal PG id from mongo_id
   */
  async getPgId(mongoId) {
    const pool = pgClient.getPool();
    const query = `SELECT id FROM users WHERE mongo_id = $1`;
    const result = await pool.query(query, [mongoId]);
    return result.rows[0]?.id || null;
  },
};

module.exports = UserModel;
