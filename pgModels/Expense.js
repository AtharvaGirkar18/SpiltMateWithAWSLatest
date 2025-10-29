/**
 * PostgreSQL Expense Model
 * Normalized with separate expense_splits table
 */

const pgClient = require("../services/pgClient");
const UserModel = require("./User");
const GroupModel = require("./Group");

const ExpenseModel = {
  tableName: "expenses",

  /**
   * Create or update an expense with splits
   */
  async upsert(expenseData) {
    const pool = pgClient.getPool();

    // Get foreign key IDs
    const groupPgId = await GroupModel.getPgId(expenseData.group_mongo_id);
    const paidByPgId = await UserModel.getPgId(expenseData.paid_by_mongo_id);

    // Upsert expense
    const expenseQuery = `
      INSERT INTO expenses (mongo_id, group_id, description, total_amount, paid_by, split_type, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (mongo_id)
      DO UPDATE SET
        description = EXCLUDED.description,
        total_amount = EXCLUDED.total_amount,
        split_type = EXCLUDED.split_type
      RETURNING id, mongo_id
    `;

    const expenseValues = [
      expenseData.mongo_id,
      groupPgId,
      expenseData.description,
      expenseData.total_amount,
      paidByPgId,
      expenseData.split_type || "equal",
      expenseData.created_at || new Date(),
    ];

    console.log("\n" + "=".repeat(80));
    console.log(`[PostgreSQL] 📝 EXPENSE SYNC - ${expenseData.description}`);
    console.log("=".repeat(80));
    console.log(`[PostgreSQL] SQL Query:`);
    console.log(expenseQuery.trim());
    console.log(`\n[PostgreSQL] Values:`);
    console.log(`  mongo_id: ${expenseValues[0]}`);
    console.log(`  group_id (PG): ${expenseValues[1]}`);
    console.log(`  description: ${expenseValues[2]}`);
    console.log(`  total_amount: ${expenseValues[3]}`);
    console.log(`  paid_by (PG id): ${expenseValues[4]}`);
    console.log(`  split_type: ${expenseValues[5]}`);

    const expenseResult = await pool.query(expenseQuery, expenseValues);
    const expensePgId = expenseResult.rows[0].id;

    console.log(
      `\n[PostgreSQL] ✓ SUCCESS - Expense inserted/updated (PG id: ${expensePgId})`
    );

    // Sync splits
    if (expenseData.splits && expenseData.splits.length > 0) {
      // Clear old splits
      const deleteQuery = `DELETE FROM expense_splits WHERE expense_id = $1`;
      console.log(`\n[PostgreSQL] SQL: ${deleteQuery}`);
      console.log(`[PostgreSQL] Values: [expense_id: ${expensePgId}]`);
      await pool.query(deleteQuery, [expensePgId]);

      // Insert new splits
      console.log(
        `\n[PostgreSQL] Inserting ${expenseData.splits.length} expense splits:`
      );
      for (const split of expenseData.splits) {
        const userPgId = await UserModel.getPgId(split.user_mongo_id);
        if (userPgId) {
          const insertSplitQuery = `INSERT INTO expense_splits (expense_id, user_id, amount) VALUES ($1, $2, $3)`;
          console.log(`  SQL: ${insertSplitQuery}`);
          console.log(
            `  Values: [expense_id: ${expensePgId}, user_id: ${userPgId}, amount: ${split.amount}]`
          );
          await pool.query(insertSplitQuery, [
            expensePgId,
            userPgId,
            split.amount,
          ]);
        }
      }
      console.log(
        `[PostgreSQL] ✓ SUCCESS - ${expenseData.splits.length} splits synced`
      );
    }
    console.log("=".repeat(80) + "\n");

    return expenseResult.rows[0];
  },

  /**
   * Get internal PG id from mongo_id
   */
  async getPgId(mongoId) {
    const pool = pgClient.getPool();
    const query = `SELECT id FROM expenses WHERE mongo_id = $1`;
    const result = await pool.query(query, [mongoId]);
    return result.rows[0]?.id || null;
  },
};

module.exports = ExpenseModel;
