/**
 * PostgreSQL Group Model
 * Normalized with separate group_members junction table
 */

const pgClient = require("../services/pgClient");
const UserModel = require("./User");

const GroupModel = {
  tableName: "groups",

  /**
   * Create or update a group with members
   */
  async upsert(groupData) {
    const pool = pgClient.getPool();

    // Get created_by PG id from mongo_id
    let createdByPgId = null;
    if (groupData.created_by_mongo_id) {
      createdByPgId = await UserModel.getPgId(groupData.created_by_mongo_id);
    }

    // Upsert group
    const groupQuery = `
      INSERT INTO groups (mongo_id, name, description, status, created_by, created_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (mongo_id)
      DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        status = EXCLUDED.status,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id, mongo_id
    `;

    const groupValues = [
      groupData.mongo_id,
      groupData.name,
      groupData.description || null,
      groupData.status || "active",
      createdByPgId,
      groupData.created_at || new Date(),
    ];

    console.log("\n" + "=".repeat(80));
    console.log(`[PostgreSQL] 📝 GROUP SYNC - ${groupData.name}`);
    console.log("=".repeat(80));
    console.log(`[PostgreSQL] SQL Query:`);
    console.log(groupQuery.trim());
    console.log(`\n[PostgreSQL] Values:`);
    console.log(`  mongo_id: ${groupValues[0]}`);
    console.log(`  name: ${groupValues[1]}`);
    console.log(`  description: ${groupValues[2]}`);
    console.log(`  status: ${groupValues[3]}`);
    console.log(`  created_by (PG id): ${groupValues[4]}`);

    const groupResult = await pool.query(groupQuery, groupValues);
    const groupPgId = groupResult.rows[0].id;

    console.log(
      `\n[PostgreSQL] ✓ SUCCESS - Group inserted/updated (PG id: ${groupPgId})`
    );

    // Sync members to junction table
    if (groupData.member_mongo_ids && groupData.member_mongo_ids.length > 0) {
      // Clear existing members
      const deleteQuery = `DELETE FROM group_members WHERE group_id = $1`;
      console.log(`\n[PostgreSQL] SQL: ${deleteQuery}`);
      console.log(`[PostgreSQL] Values: [group_id: ${groupPgId}]`);
      await pool.query(deleteQuery, [groupPgId]);

      // Insert new members
      console.log(
        `\n[PostgreSQL] Inserting ${groupData.member_mongo_ids.length} group members:`
      );
      for (const memberMongoId of groupData.member_mongo_ids) {
        const memberPgId = await UserModel.getPgId(memberMongoId);
        if (memberPgId) {
          const insertMemberQuery = `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`;
          console.log(`  SQL: ${insertMemberQuery}`);
          console.log(
            `  Values: [group_id: ${groupPgId}, user_id: ${memberPgId}]`
          );
          await pool.query(insertMemberQuery, [groupPgId, memberPgId]);
        }
      }
      console.log(
        `[PostgreSQL] ✓ SUCCESS - ${groupData.member_mongo_ids.length} members synced`
      );
    }
    console.log("=".repeat(80) + "\n");

    return groupResult.rows[0];
  },

  /**
   * Get internal PG id from mongo_id
   */
  async getPgId(mongoId) {
    const pool = pgClient.getPool();
    const query = `SELECT id FROM groups WHERE mongo_id = $1`;
    const result = await pool.query(query, [mongoId]);
    return result.rows[0]?.id || null;
  },
};

module.exports = GroupModel;
