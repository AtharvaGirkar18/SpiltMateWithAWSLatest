const pgClient = require("./pgClient");
const UserModel = require("../pgModels/User");
const GroupModel = require("../pgModels/Group");
const ExpenseModel = require("../pgModels/Expense");

function _toPlain(obj) {
  if (!obj) return obj;
  if (typeof obj.toObject === "function") return obj.toObject();
  return obj;
}

async function syncUser(userDoc) {
  try {
    const u = _toPlain(userDoc);
    const mongoId =
      (u._id && u._id.toString && u._id.toString()) || u.id || null;

    const userData = {
      mongo_id: mongoId,
      first_name: u.firstName || u.first_name || null,
      last_name: u.lastName || u.last_name || null,
      email: u.email || null,
      password: u.password || null,
      profile_pic_url: u.profilePicUrl || u.profile_pic_url || null,
      profile_pic_key: u.profilePicKey || u.profile_pic_key || null,
      phone: u.phone || null,
      upi_link: u.upiLink || u.upi_link || null,
      created_at: u.createdAt ? new Date(u.createdAt) : new Date(),
    };

    await UserModel.upsert(userData);
    return true;
  } catch (err) {
    console.warn(
      "[PostgreSQL] ✗ syncUser failed:",
      err && err.message ? err.message : err
    );
    return false;
  }
}

async function syncGroup(groupDoc) {
  try {
    const g = _toPlain(groupDoc);
    const mongoId =
      (g._id && g._id.toString && g._id.toString()) ||
      (g.id && typeof g.id === "string") ||
      null;

    // Extract member mongo_ids
    const memberMongoIds = (g.members || [])
      .map((m) => {
        if (!m) return null;
        if (typeof m === "string") return m;
        if (m._id && m._id.toString) return m._id.toString();
        if (m.id && typeof m.id === "string") return m.id;
        if (m.toString) return m.toString();
        return null;
      })
      .filter(Boolean);

    // Extract created_by mongo_id
    let createdByMongoId = null;
    if (g.createdBy) {
      if (typeof g.createdBy === "string") {
        createdByMongoId = g.createdBy;
      } else if (g.createdBy._id && g.createdBy._id.toString) {
        createdByMongoId = g.createdBy._id.toString();
      } else if (g.createdBy.toString) {
        createdByMongoId = g.createdBy.toString();
      }
    }

    const groupData = {
      mongo_id: mongoId,
      name: g.name || null,
      description: g.description || null,
      status: g.status || "active",
      created_by_mongo_id: createdByMongoId,
      member_mongo_ids: memberMongoIds,
      created_at: g.createdAt ? new Date(g.createdAt) : new Date(),
    };

    await GroupModel.upsert(groupData);
    return true;
  } catch (err) {
    console.warn(
      "[PostgreSQL] ✗ syncGroup failed:",
      err && err.message ? err.message : err
    );
    return false;
  }
}

async function syncExpense(expenseDoc) {
  try {
    const e = _toPlain(expenseDoc);
    const mongoId =
      (e._id && e._id.toString && e._id.toString()) || e.id || null;

    // Extract group mongo_id
    let groupMongoId = null;
    if (e.group) {
      if (typeof e.group === "string") {
        groupMongoId = e.group;
      } else if (e.group._id && e.group._id.toString) {
        groupMongoId = e.group._id.toString();
      } else if (e.group.toString) {
        groupMongoId = e.group.toString();
      }
    }

    // Extract paid_by mongo_id
    let paidByMongoId = null;
    if (e.paidBy) {
      if (typeof e.paidBy === "string") {
        paidByMongoId = e.paidBy;
      } else if (e.paidBy._id && e.paidBy._id.toString) {
        paidByMongoId = e.paidBy._id.toString();
      } else if (e.paidBy.toString) {
        paidByMongoId = e.paidBy.toString();
      }
    }

    // Extract splits with user mongo_ids
    const splits = (e.splits || [])
      .map((s) => {
        let userMongoId = null;
        if (s.user) {
          if (typeof s.user === "string") {
            userMongoId = s.user;
          } else if (s.user._id && s.user._id.toString) {
            userMongoId = s.user._id.toString();
          } else if (s.user.toString) {
            userMongoId = s.user.toString();
          }
        } else if (s.userId) {
          userMongoId = s.userId;
        }

        return {
          user_mongo_id: userMongoId,
          amount: Number(s.amount) || 0,
        };
      })
      .filter((s) => s.user_mongo_id);

    const expenseData = {
      mongo_id: mongoId,
      group_mongo_id: groupMongoId,
      description: e.description || null,
      total_amount: Number(e.totalAmount) || 0,
      paid_by_mongo_id: paidByMongoId,
      split_type: e.splitType || "equal",
      splits,
      created_at: e.createdAt ? new Date(e.createdAt) : new Date(),
    };

    await ExpenseModel.upsert(expenseData);
    return true;
  } catch (err) {
    console.warn(
      "[PostgreSQL] ✗ syncExpense failed:",
      err && err.message ? err.message : err
    );
    return false;
  }
}

module.exports = { syncUser, syncGroup, syncExpense };
