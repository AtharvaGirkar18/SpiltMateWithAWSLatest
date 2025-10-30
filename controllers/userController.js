const User = require("../models/user");
const Group = require("../models/group");
const Expense = require("../models/expense");
const PaymentRequest = require("../models/paymentRequest");
const path = require("path");
const fs = require("fs");
const { s3, bucketName } = require("../uploads3");
const { DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");

const pgSync = require("../services/pgSync");

const lambdaClient = new LambdaClient({});

async function invokeLambda(functionName, payload) {
  try {
    // Lightweight debug toggle: set LAMBDA_DEBUG=1
    const debugEnabled =
      process.env.LAMBDA_DEBUG === "1" || process.env.NODE_ENV !== "production";
    if (debugEnabled) {
      try {
        const payloadSummary = Array.isArray(payload)
          ? `array(len=${payload.length})`
          : payload && typeof payload === "object"
          ? Object.keys(payload)
          : typeof payload;
        console.log(
          `Invoking Lambda ${functionName} — payload summary:`,
          payloadSummary
        );
      } catch (e) {
        console.log(`Invoking Lambda ${functionName}`);
      }
    }

    const cmd = new InvokeCommand({
      FunctionName: functionName,
      Payload: Buffer.from(JSON.stringify(payload)),
    });
    const resp = await lambdaClient.send(cmd);
    if (resp.FunctionError) {
      throw new Error(`Lambda ${functionName} error: ${resp.FunctionError}`);
    }
    if (!resp.Payload) {
      if (debugEnabled)
        console.log(`Lambda ${functionName} returned empty payload`);
      return null;
    }
    const raw = Buffer.from(resp.Payload).toString();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      parsed = raw;
    }
    if (debugEnabled) {
      try {
        console.log(
          `Lambda ${functionName} response (parsed):`,
          typeof parsed === "string" ? parsed : JSON.stringify(parsed)
        );
      } catch (e) {
        console.log(`Lambda ${functionName} response (raw):`, raw);
      }
    }
    return parsed;
  } catch (err) {
    console.warn(
      `invokeLambda ${functionName} failed:`,
      err && err.message ? err.message : err
    );
    throw err;
  }
}

// Helper to unwrap Lambda responses that may be returned as
// { statusCode, body } (API-proxy) or as a direct object/string.
function unwrapLambdaResponse(resp) {
  if (!resp) return null;
  if (typeof resp === "object" && resp.netBalances !== undefined) return resp;
  if (typeof resp === "object" && resp.body !== undefined) {
    try {
      return typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
    } catch (e) {
      return resp.body;
    }
  }
  if (typeof resp === "string") {
    try {
      return JSON.parse(resp);
    } catch (e) {
      return resp;
    }
  }
  return resp;
}

function getPairKey(userId1, userId2) {
  return userId1 < userId2 ? userId1 + "-" + userId2 : userId2 + "-" + userId1;
}

const getGroups = async (req, res, next) => {
  if (!req.session.user || !req.session.isLoggedIn) {
    return res.redirect("/auth/login");
  }

  try {
    // Fetch groups from DB where current user is a member
    const groups = await Group.find({ members: req.session.user._id }).populate(
      "members"
    );

    // Fetch expenses for each group and add to group object
    for (let group of groups) {
      const expenses = await Expense.find({ group: group._id });
      group.expenses = expenses;
    }

    // Generate presigned URLs for members in each group (so avatars render when objects are private)
    try {
      if (groups && groups.length > 0 && bucketName) {
        for (const group of groups) {
          if (group.members && group.members.length > 0) {
            for (const member of group.members) {
              // Prefer explicit stored key when available
              let Key = null;
              if (member && member.profilePicKey) {
                Key = member.profilePicKey;
              } else if (member && member.profilePicUrl) {
                const match = member.profilePicUrl.match(/profile-images\/.+/);
                if (match) Key = match[0];
              }

              if (Key) {
                try {
                  member.signedProfilePicUrl = await getSignedUrl(
                    s3,
                    new GetObjectCommand({ Bucket: bucketName, Key }),
                    { expiresIn: 60 }
                  );
                } catch (err) {
                  // ignore presign failures
                }
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "Presign generation failed in getGroups:",
        err && err.message ? err.message : err
      );
    }

    res.render("user/groups", {
      pageTitle: "My Groups",
      isLoggedIn: true,
      user: req.session.user,
      groups: groups,
    });
  } catch (error) {
    console.error("Error fetching groups:", error);
    res.render("user/groups", {
      pageTitle: "My Groups",
      isLoggedIn: true,
      user: req.session.user,
      groups: [],
      errors: ["Failed to load groups"],
    });
  }
};

exports.getGroups = getGroups;

// Make sure you have this defined

exports.showCreateGroup = (req, res) => {
  res.render("user/create-group", {
    errors: [],
    pageTitle: "Create Group",
    isLoggedIn: req.session.isLoggedIn,
    user: req.session.user,
  });
};

exports.createGroup = async (req, res) => {
  try {
    const { groupName, groupDescription, members } = req.body;
    const memberIds = JSON.parse(members || "[]");
    if (!groupName || memberIds.length === 0) {
      return res.render("user/create-group", {
        errors: ["Group name and at least one member are required."],
      });
    }
    // Add current user to group members automatically
    if (!memberIds.includes(req.session.user._id)) {
      memberIds.push(req.session.user._id);
    }
    const group = new Group({
      name: groupName,
      description: groupDescription,
      members: memberIds,
      createdBy: req.session.user._id, // <-- Add this line
    });
    await group.save();
    // Fire-and-forget Postgres sync (do not block user flow)
    if (
      process.env.DB_HOST ||
      process.env.DB_USER ||
      process.env.DB_NAME ||
      process.env.PG_HOST ||
      process.env.PG_USER ||
      process.env.PGDATABASE
    ) {
      pgSync
        .syncGroup(group)
        .then((ok) => {
          if (!ok)
            console.warn("Group saved in MongoDB but Postgres sync failed");
        })
        .catch((e) =>
          console.warn(
            "Pg sync error for group:",
            e && e.message ? e.message : e
          )
        );
    }
    res.redirect("/user/groups"); // show updated groups
  } catch (err) {
    res.render("user/create-group", {
      errors: [err.message],
      pageTitle: "Create Group",
      isLoggedIn: req.session.isLoggedIn,
      user: req.session.user,
    });
  }
};

exports.liveUserSearch = async (req, res) => {
  try {
    const q = req.query.q;
    if (!q || q.trim().length < 2) return res.json([]);
    // Match users by username/email (case-insensitive)
    const users = await User.find({
      $or: [
        { email: new RegExp(q, "i") },
        { firstName: new RegExp(q, "i") },
        { lastName: new RegExp(q, "i") },
      ],
    }).select("_id firstName lastName email profilePicUrl profilePicKey");

    // Add presigned URLs for returned users when possible
    if (users && users.length > 0 && bucketName) {
      for (const u of users) {
        let Key = null;
        if (u.profilePicKey) {
          Key = u.profilePicKey;
        } else if (u.profilePicUrl) {
          const match = u.profilePicUrl.match(/profile-images\/.+/);
          if (match) Key = match[0];
        }

        if (Key) {
          try {
            u.signedProfilePicUrl = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: bucketName, Key }),
              { expiresIn: 60 }
            );
          } catch (err) {
            // If presign fails (commonly due to expired/missing credentials),
            // avoid returning a private S3 URL to the client which will 403 —
            // instead clear the profilePicUrl so the UI falls back to initials.
            console.warn(
              "Presign failed for user search (profilePicKey=",
              Key,
              "):",
              err && err.message ? err.message : err
            );
            u.signedProfilePicUrl = null;
            // clear public URL so client uses initials instead of a (likely private) URL
            u.profilePicUrl = null;
          }
        }
      }
    }

    res.json(users);
  } catch (err) {
    res.json([]);
  }
};

// Show group page with summary of you owe and you are owed amounts
exports.showGroupDetail = async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const currentUserId = req.session.user._id.toString();

    const group = await Group.findById(groupId).populate("members");
    const expenses = await Expense.find({ group: groupId }).populate(
      "paidBy splits.user"
    );
    // Generate presigned URLs for group members and expense payers if their images are stored on S3
    try {
      if (group && group.members && bucketName) {
        for (const member of group.members) {
          let Key = null;
          if (member && member.profilePicKey) {
            Key = member.profilePicKey;
          } else if (member && member.profilePicUrl) {
            const match = member.profilePicUrl.match(/profile-images\/.+/);
            if (match) Key = match[0];
          }

          if (Key) {
            try {
              member.signedProfilePicUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucketName, Key }),
                { expiresIn: 60 }
              );
            } catch (err) {
              // ignore presign failures
            }
          }
        }
      }

      if (expenses && expenses.length > 0) {
        for (const expense of expenses) {
          if (expense.paidBy) {
            let Key = null;
            if (expense.paidBy.profilePicKey) {
              Key = expense.paidBy.profilePicKey;
            } else if (expense.paidBy.profilePicUrl) {
              const match =
                expense.paidBy.profilePicUrl.match(/profile-images\/.+/);
              if (match) Key = match[0];
            }

            if (Key) {
              try {
                expense.paidBy.signedProfilePicUrl = await getSignedUrl(
                  s3,
                  new GetObjectCommand({ Bucket: bucketName, Key }),
                  { expiresIn: 60 }
                );
              } catch (err) {
                // ignore
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "Presign generation failed in showGroupDetail:",
        err && err.message ? err.message : err
      );
    }
    const paymentRequestsFrom = await PaymentRequest.find({
      group: groupId,
      fromUser: currentUserId,
    });
    const paymentRequestsTo = await PaymentRequest.find({
      group: groupId,
      toUser: currentUserId,
    });
    // fetch only paid payment requests for this group so Lambdas can account for settled payments
    const paidPaymentRequests = await PaymentRequest.find({
      group: groupId,
      status: "paid",
    }).lean();

    // Prepare expense payload for Lambda
    let netAmounts = null;
    try {
      const expensesPayload = (expenses || []).map((e) => {
        const amount = Number(e.totalAmount || e.amount || 0);
        const payerId =
          e.paidBy && e.paidBy._id
            ? e.paidBy._id.toString()
            : (e.paidBy && e.paidBy.userId) || null;
        const paidByArr = payerId ? [{ userId: payerId, amount }] : [];
        const splitsArr = (e.splits || []).map((s) => ({
          userId: s.user && s.user._id ? s.user._id.toString() : s.userId,
          amount: Number(s.amount) || 0,
        }));
        return { amount, paidBy: paidByArr, splits: splitsArr };
      });

      // Convert paid payment requests to Lambda format
      const paidPaymentRequestsForLambda = paidPaymentRequests.map((pr) => ({
        from: pr.fromUser ? pr.fromUser.toString() : pr.from,
        to: pr.toUser ? pr.toUser.toString() : pr.to,
        amount: Number(pr.amount || 0),
        status: pr.status,
      }));

      // Use pairwise balances Lambda to get accurate "who owes whom" relationships
      const pairwiseResp = await invokeLambda("calculatePairwiseBalances", {
        expenses: expensesPayload,
        members: (group.members || []).map((m) =>
          typeof m === "string" ? m : (m._id || m).toString()
        ),
        paymentRequests: paidPaymentRequestsForLambda,
      });
      const pairwiseData = unwrapLambdaResponse(pairwiseResp);

      if (!pairwiseData || !pairwiseData.userBalances) {
        console.error(
          "calculatePairwiseBalances returned unexpected response:",
          pairwiseResp
        );
        return res.render("user/group-detail", {
          pageTitle: group ? group.name : "Group",
          isLoggedIn: req.session.isLoggedIn,
          user: req.session.user,
          req: req,
          group,
          expenses,
          amountOwedToUser: 0,
          amountUserOwes: 0,
          showGroupButtons: true,
          currentGroupId: group ? group._id : null,
          errors: ["Calculation service is unavailable. Try again later."],
        });
      }

      // Build netAmounts from pairwise balances for this user
      // Format: netAmounts[otherUserId] = positive if they owe me, negative if I owe them
      netAmounts = {};
      const pairwiseBalances = pairwiseData.pairwiseBalances || {};

      for (const [pairKey, balance] of Object.entries(pairwiseBalances)) {
        const [user1, user2] = pairKey.split("->");

        if (balance > 0) {
          // user2 owes user1
          if (user1 === currentUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) + balance;
          } else if (user2 === currentUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) - balance;
          }
        } else if (balance < 0) {
          // user1 owes user2
          if (user2 === currentUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) + Math.abs(balance);
          } else if (user1 === currentUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) - Math.abs(balance);
          }
        }
      }

      // Get totals from userBalances
      const userBalance = pairwiseData.userBalances[currentUserId] || {};
      let amountOwedToUser = userBalance.youAreOwed || 0;
      let amountUserOwes = userBalance.youOwe || 0;
    } catch (err) {
      console.error(
        "Lambda-based balance/settlement failed in showGroupDetail:",
        err && err.message ? err.message : err
      );
      return res.render("user/group-detail", {
        pageTitle: group ? group.name : "Group",
        isLoggedIn: req.session.isLoggedIn,
        user: req.session.user,
        req: req,
        group,
        expenses,
        amountOwedToUser: 0,
        amountUserOwes: 0,
        showGroupButtons: true,
        currentGroupId: group ? group._id : null,
        errors: ["Calculation service is unavailable. Try again later."],
      });
    }

    // Calculate amounts owed to user (positive netAmounts)
    let amountOwedToUser = 0;
    let amountUserOwes = 0;
    for (const key in netAmounts) {
      const v = Number(netAmounts[key] || 0);
      if (v > 0) amountOwedToUser += v;
      if (v < 0) amountUserOwes += Math.abs(v);
    }

    res.render("user/group-detail", {
      pageTitle: group.name,
      isLoggedIn: req.session.isLoggedIn,
      user: req.session.user,
      req: req,
      group,
      expenses,
      amountOwedToUser,
      amountUserOwes,
      showGroupButtons: true,
      currentGroupId: group._id,
    });
  } catch (err) {
    console.error(err);
    res.redirect("/user/groups");
  }
};

exports.showEditGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.groupId).populate("members");
    if (!group) {
      return res.redirect("/user/groups");
    }
    // Generate presigned URLs for members' profile pictures
    try {
      if (group && group.members && bucketName) {
        for (const member of group.members) {
          let Key = null;
          if (member && member.profilePicKey) {
            Key = member.profilePicKey;
          } else if (member && member.profilePicUrl) {
            const match = member.profilePicUrl.match(/profile-images\/.+/);
            if (match) Key = match[0];
          }

          if (Key) {
            try {
              member.signedProfilePicUrl = await getSignedUrl(
                s3,
                new GetObjectCommand({ Bucket: bucketName, Key }),
                { expiresIn: 60 }
              );
            } catch (err) {
              // ignore
            }
          }
        }
      }
    } catch (err) {
      console.warn(
        "Presign generation failed in showEditGroup:",
        err && err.message ? err.message : err
      );
    }
    res.render("user/edit-group", {
      pageTitle: "Edit Group",
      isLoggedIn: req.session.isLoggedIn,
      user: req.session.user,
      group,
      errors: [],
    });
  } catch (err) {
    console.error(err);
    res.redirect("/user/groups");
  }
};

exports.editGroup = async (req, res) => {
  try {
    const groupId = req.params.groupId;
    let { members } = req.body;

    if (!members) {
      members = "[]";
    }

    const updatedMembers = JSON.parse(members);

    // Ensure current user remains a member to avoid lockout
    if (!updatedMembers.includes(req.session.user._id)) {
      updatedMembers.push(req.session.user._id);
    }

    await Group.findByIdAndUpdate(groupId, { members: updatedMembers });

    // Fire-and-forget Postgres sync for updated group
    try {
      const updatedGroup = await Group.findById(groupId);
      if (
        process.env.PG_HOST ||
        process.env.PG_USER ||
        process.env.PGDATABASE
      ) {
        pgSync
          .syncGroup(updatedGroup)
          .then((ok) => {
            if (!ok)
              console.warn("Group updated in MongoDB but Postgres sync failed");
          })
          .catch((e) =>
            console.warn(
              "Pg sync error for group (update):",
              e && e.message ? e.message : e
            )
          );
      }
    } catch (e) {
      // don't block on sync errors
      console.warn(
        "Postgres sync (group update) preparation failed:",
        e && e.message ? e.message : e
      );
    }

    res.redirect(`/user/groups/${groupId}`);
  } catch (err) {
    console.error(err);
    // If error, re-render edit page with error
    const group = await Group.findById(req.params.groupId).populate("members");
    res.render("user/edit-group", {
      pageTitle: "Edit Group",
      isLoggedIn: req.session.isLoggedIn,
      user: req.session.user,
      group,
      errors: [err.message],
    });
  }
};

// Show add expense form
exports.showAddExpense = async (req, res) => {
  const group = await Group.findById(req.params.groupId).populate("members");
  if (!group) return res.redirect("/user/groups");

  // Redirect if group is in settlement mode
  if (group.status === "ready_to_settle") {
    return res.redirect(`/user/groups/${group._id}?error=settlement_mode`);
  }

  // Generate presigned URLs for members' profile pictures if present on S3
  try {
    if (group && group.members && bucketName) {
      for (const member of group.members) {
        let Key = null;
        if (member && member.profilePicKey) {
          Key = member.profilePicKey;
        } else if (member && member.profilePicUrl) {
          const match = member.profilePicUrl.match(/profile-images\/.+/);
          if (match) Key = match[0];
        }

        if (Key) {
          try {
            member.signedProfilePicUrl = await getSignedUrl(
              s3,
              new GetObjectCommand({ Bucket: bucketName, Key }),
              { expiresIn: 60 }
            );
          } catch (err) {
            // ignore presign failures
          }
        }
      }
    }
  } catch (err) {
    console.warn(
      "Presign generation failed in showAddExpense:",
      err && err.message ? err.message : err
    );
  }

  res.render("user/add-expense", {
    pageTitle: "Add Expense",
    isLoggedIn: req.session.isLoggedIn,
    user: req.session.user,
    group,
    errors: [],
    showGroupButtons: true,
    currentGroupId: group._id,
  });
};

// Add expense handler
exports.addExpense = async (req, res) => {
  try {
    const groupId = req.params.groupId;

    // Check if group is in settlement mode
    const group = await Group.findById(groupId);
    if (!group) {
      return res.status(404).send("Group not found");
    }

    if (group.status === "ready_to_settle") {
      return res
        .status(400)
        .send(
          "Cannot add expenses to a group that is ready to settle. Ask the group creator to reopen the session."
        );
    }

    const {
      description,
      totalAmount,
      paidBy,
      splitMembers,
      splitType,
      unequalAmounts,
    } = req.body;

    let members = Array.isArray(splitMembers) ? splitMembers : [splitMembers];

    if (!description || !totalAmount || !paidBy || members.length < 1)
      throw new Error("Fill all mandatory fields.");

    if (splitType === "unequal") {
      // Check if unequalAmounts object exists and has values for all members
      if (!unequalAmounts || typeof unequalAmounts !== "object") {
        throw new Error("Specify all unequal amounts.");
      }

      const values = [];
      let hasEmptyValues = false;

      // Check each member has a corresponding amount
      for (let memberId of members) {
        const amount = unequalAmounts[memberId];
        if (
          amount === undefined ||
          amount === null ||
          amount === "" ||
          isNaN(Number(amount))
        ) {
          hasEmptyValues = true;
          break;
        }
        values.push(Number(amount));
      }

      if (hasEmptyValues || values.length !== members.length) {
        throw new Error("Specify all unequal amounts.");
      }

      const sum = values.reduce((a, b) => a + b, 0);
      if (Math.abs(sum - Number(totalAmount)) > 0.01)
        throw new Error("Sum of amounts must match total.");
    }

    // Build splits array via normalizeExpensesForLambda (required)
    const rawExpense = {
      amount: Number(totalAmount),
      paidBy: Array.isArray(paidBy)
        ? paidBy.map((p) => ({ userId: p.userId || p._id || p }))
        : [{ userId: paidBy }],
      splitType: splitType === "unequal" ? "unequal" : "equal",
      members,
    };
    if (splitType === "unequal") {
      rawExpense.exact = {};
      for (const mid of members) {
        rawExpense.exact[mid] = Number(unequalAmounts[mid]);
      }
    }

    const normResp = await invokeLambda("normalizeExpensesForLambda", {
      rawExpenses: [rawExpense],
    });
    const norm = unwrapLambdaResponse(normResp);
    if (
      !norm ||
      !Array.isArray(norm.expenses) ||
      !norm.expenses[0] ||
      !Array.isArray(norm.expenses[0].splits)
    ) {
      console.error(
        "normalizeExpensesForLambda returned unexpected response:",
        normResp
      );
      throw new Error("normalizeExpensesForLambda returned unexpected shape");
    }
    const splits = norm.expenses[0].splits.map((s) => ({
      user: s.userId || s.user,
      amount: Number(s.amount),
    }));

    // Normalize saved fields to match Expense schema
    const savedTotal = Number(totalAmount);
    // paidBy in schema is a single ObjectId; prefer first payer if array provided
    let savedPaidBy = null;
    if (Array.isArray(paidBy)) {
      const first = paidBy[0];
      savedPaidBy =
        first && (first.userId || first._id || first)
          ? first.userId || first._id || first
          : null;
    } else if (paidBy && typeof paidBy === "object") {
      savedPaidBy = paidBy.userId || paidBy._id || null;
    } else {
      savedPaidBy = paidBy;
    }

    // Create and save expense document
    const expense = new Expense({
      group: groupId,
      description,
      totalAmount: savedTotal,
      paidBy: savedPaidBy,
      splitType,
      splits,
    });

    await expense.save();
    // Fire-and-forget Postgres sync for expense
    if (
      process.env.DB_HOST ||
      process.env.DB_USER ||
      process.env.DB_NAME ||
      process.env.PG_HOST ||
      process.env.PG_USER ||
      process.env.PGDATABASE
    ) {
      pgSync
        .syncExpense(expense)
        .then((ok) => {
          if (!ok)
            console.warn("Expense saved in MongoDB but Postgres sync failed");
        })
        .catch((e) =>
          console.warn(
            "Pg sync error for expense:",
            e && e.message ? e.message : e
          )
        );
    }

    await Group.findByIdAndUpdate(groupId, {
      $push: { expenses: expense._id },
    });

    res.redirect(`/user/groups/${groupId}`);
  } catch (err) {
    const group = await Group.findById(req.params.groupId).populate("members");
    res.render("user/add-expense", {
      pageTitle: "Add Expense",
      isLoggedIn: req.session.isLoggedIn,
      user: req.session.user,
      group,
      errors: [err.message],
      showGroupButtons: true,
      currentGroupId: req.params.groupId,
    });
  }
};

exports.showYouOwe = async (req, res) => {
  const groupId = req.params.groupId;
  const currentUserId = req.session.user._id.toString();

  const expenses = await Expense.find({ group: groupId }).populate(
    "paidBy splits.user"
  );
  const paymentRequests = await PaymentRequest.find({
    group: groupId,
    fromUser: currentUserId,
  }).populate("toUser");

  // Try Lambda-based calculation first (pairwise balances), else fallback to local computation
  let netAmounts = null;
  try {
    const expensesPayload = (expenses || []).map((e) => {
      const amount = Number(e.totalAmount || e.amount || 0);
      const payerId =
        e.paidBy && e.paidBy._id
          ? e.paidBy._id.toString()
          : (e.paidBy && e.paidBy.userId) || null;
      const paidByArr = payerId ? [{ userId: payerId, amount }] : [];
      const splitsArr = (e.splits || []).map((s) => ({
        userId: s.user && s.user._id ? s.user._id.toString() : s.userId,
        amount: Number(s.amount) || 0,
      }));
      return { amount, paidBy: paidByArr, splits: splitsArr };
    });

    // include only paid payment requests so Lambda can apply settled payments
    const paidPaymentRequests = await PaymentRequest.find({
      group: groupId,
      status: "paid",
    }).lean();

    const paidPaymentRequestsForLambda = paidPaymentRequests.map((pr) => ({
      from: pr.fromUser ? pr.fromUser.toString() : pr.from,
      to: pr.toUser ? pr.toUser.toString() : pr.to,
      amount: Number(pr.amount || 0),
      status: pr.status,
    }));

    const group = await Group.findById(groupId).populate("members");

    const pairwiseResp = await invokeLambda("calculatePairwiseBalances", {
      expenses: expensesPayload,
      members: (group.members || []).map((m) =>
        typeof m === "string" ? m : (m._id || m).toString()
      ),
      paymentRequests: paidPaymentRequestsForLambda,
    });
    const pairwiseData = unwrapLambdaResponse(pairwiseResp);

    if (pairwiseData && pairwiseData.pairwiseBalances) {
      // Build netAmounts from pairwise balances for this user
      // Format: netAmounts[otherUserId] = positive if they owe me, negative if I owe them
      netAmounts = {};
      const pairwiseBalances = pairwiseData.pairwiseBalances || {};

      for (const [pairKey, balance] of Object.entries(pairwiseBalances)) {
        const [user1, user2] = pairKey.split("->");

        if (balance > 0) {
          // user2 owes user1
          if (user1 === currentUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) + balance;
          } else if (user2 === currentUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) - balance;
          }
        } else if (balance < 0) {
          // user1 owes user2
          if (user2 === currentUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) + Math.abs(balance);
          } else if (user1 === currentUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) - Math.abs(balance);
          }
        }
      }
    } else {
      // ensure netAmounts is at least an empty map to avoid later crashes
      netAmounts = {};
    }
  } catch (err) {
    console.error(
      "Lambda calculation failed in showYouOwe:",
      err && err.message ? err.message : err
    );
    return res.redirect(`/user/groups/${groupId}`);
  }

  const group = await Group.findById(groupId).populate("members");
  const members = group.members.filter((m) => netAmounts[m._id.toString()] < 0);

  const amountsYouOwe = {};
  members.forEach((m) => {
    amountsYouOwe[m._id.toString()] = Math.abs(netAmounts[m._id.toString()]);
  });

  res.render("user/you-owe", {
    pageTitle: "You Owe",
    isLoggedIn: req.session.isLoggedIn,
    user: req.session.user,
    groupId,
    group,
    members,
    amountsYouOwe,
    paymentRequests,
  });
};

exports.showYouAreOwed = async (req, res) => {
  const groupId = req.params.groupId;
  const currentUserId = req.session.user._id.toString();

  const expenses = await Expense.find({ group: groupId }).populate(
    "paidBy splits.user"
  );
  const paymentRequests = await PaymentRequest.find({
    group: groupId,
    toUser: currentUserId,
  }).populate("fromUser");

  // Try Lambda-based calculation (group balances -> settlement), else use local fallback
  let netAmounts = null;
  try {
    const expensesPayload = (expenses || []).map((e) => {
      const amount = Number(e.totalAmount || e.amount || 0);
      const payerId =
        e.paidBy && e.paidBy._id
          ? e.paidBy._id.toString()
          : (e.paidBy && e.paidBy.userId) || null;
      const paidByArr = payerId ? [{ userId: payerId, amount }] : [];
      const splitsArr = (e.splits || []).map((s) => ({
        userId: s.user && s.user._id ? s.user._id.toString() : s.userId,
        amount: Number(s.amount) || 0,
      }));
      return { amount, paidBy: paidByArr, splits: splitsArr };
    });

    // include only paid payment requests so Lambda can apply settled payments
    const paidPaymentRequests = await PaymentRequest.find({
      group: groupId,
      status: "paid",
    }).lean();

    const paidPaymentRequestsForLambda = paidPaymentRequests.map((pr) => ({
      from: pr.fromUser ? pr.fromUser.toString() : pr.from,
      to: pr.toUser ? pr.toUser.toString() : pr.to,
      amount: Number(pr.amount || 0),
      status: pr.status,
    }));

    const group = await Group.findById(groupId).populate("members");

    const pairwiseResp = await invokeLambda("calculatePairwiseBalances", {
      expenses: expensesPayload,
      members: (group.members || []).map((m) =>
        typeof m === "string" ? m : (m._id || m).toString()
      ),
      paymentRequests: paidPaymentRequestsForLambda,
    });
    const pairwiseData = unwrapLambdaResponse(pairwiseResp);

    if (pairwiseData && pairwiseData.pairwiseBalances) {
      // Build netAmounts from pairwise balances for this user
      netAmounts = {};
      const pairwiseBalances = pairwiseData.pairwiseBalances || {};

      for (const [pairKey, balance] of Object.entries(pairwiseBalances)) {
        const [user1, user2] = pairKey.split("->");

        if (balance > 0) {
          // user2 owes user1
          if (user1 === currentUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) + balance;
          } else if (user2 === currentUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) - balance;
          }
        } else if (balance < 0) {
          // user1 owes user2
          if (user2 === currentUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) + Math.abs(balance);
          } else if (user1 === currentUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) - Math.abs(balance);
          }
        }
      }
    } else {
      netAmounts = {};
    }
  } catch (err) {
    console.error(
      "Lambda calculation failed in showYouAreOwed:",
      err && err.message ? err.message : err
    );
    return res.redirect(`/user/groups/${groupId}`);
  }

  const group = await Group.findById(groupId).populate("members");
  const members = group.members.filter((m) => netAmounts[m._id.toString()] > 0);

  const amountsOwed = {};
  members.forEach((m) => {
    amountsOwed[m._id.toString()] = netAmounts[m._id.toString()];
  });

  res.render("user/you-are-owed", {
    pageTitle: "You Are Owed",
    isLoggedIn: req.session.isLoggedIn,
    user: req.session.user,
    groupId,
    group,
    members,
    amountsOwed,
    paymentRequests,
  });
};

exports.showPayForm = async (req, res) => {
  const { groupId, toUserId } = req.params;
  const fromUserId = req.session.user._id.toString();

  const group = await Group.findById(groupId);
  const toUser = await User.findById(toUserId);

  // Check if group session is active
  if (group.status === "active") {
    req.session.message = {
      type: "error",
      text: 'Cannot make payments while group session is active. Wait for the session to be marked as "Ready to Settle".',
    };
    return res.redirect(`/user/groups/${groupId}/you-owe`);
  }

  // Use same balance calculation logic as other functions
  const expenses = await Expense.find({ group: groupId }).populate(
    "paidBy splits.user"
  );

  // Try Lambda-based calculation (pairwise balances), else fallback local
  let netAmounts = null;
  try {
    const expensesPayload = (expenses || []).map((e) => {
      const amount = Number(e.totalAmount || e.amount || 0);
      const payerId =
        e.paidBy && e.paidBy._id
          ? e.paidBy._id.toString()
          : (e.paidBy && e.paidBy.userId) || null;
      const paidByArr = payerId ? [{ userId: payerId, amount }] : [];
      const splitsArr = (e.splits || []).map((s) => ({
        userId: s.user && s.user._id ? s.user._id.toString() : s.userId,
        amount: Number(s.amount) || 0,
      }));
      return { amount, paidBy: paidByArr, splits: splitsArr };
    });

    // include only paid payment requests so Lambda can apply settled payments
    const paidPaymentRequests = await PaymentRequest.find({
      group: groupId,
      status: "paid",
    }).lean();

    const paidPaymentRequestsForLambda = paidPaymentRequests.map((pr) => ({
      from: pr.fromUser ? pr.fromUser.toString() : pr.from,
      to: pr.toUser ? pr.toUser.toString() : pr.to,
      amount: Number(pr.amount || 0),
      status: pr.status,
    }));

    const pairwiseResp = await invokeLambda("calculatePairwiseBalances", {
      expenses: expensesPayload,
      members: (group.members || []).map((m) =>
        typeof m === "string" ? m : (m._id || m).toString()
      ),
      paymentRequests: paidPaymentRequestsForLambda,
    });
    const pairwiseData = unwrapLambdaResponse(pairwiseResp);

    if (pairwiseData && pairwiseData.pairwiseBalances) {
      // Build netAmounts from pairwise balances for this user
      netAmounts = {};
      const pairwiseBalances = pairwiseData.pairwiseBalances || {};

      for (const [pairKey, balance] of Object.entries(pairwiseBalances)) {
        const [user1, user2] = pairKey.split("->");

        if (balance > 0) {
          // user2 owes user1
          if (user1 === fromUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) + balance;
          } else if (user2 === fromUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) - balance;
          }
        } else if (balance < 0) {
          // user1 owes user2
          if (user2 === fromUserId) {
            netAmounts[user1] = (netAmounts[user1] || 0) + Math.abs(balance);
          } else if (user1 === fromUserId) {
            netAmounts[user2] = (netAmounts[user2] || 0) - Math.abs(balance);
          }
        }
      }
    } else {
      netAmounts = {};
    }
  } catch (err) {
    console.error(
      "Lambda calculation failed in showPayForm:",
      err && err.message ? err.message : err
    );
    return res.redirect(`/user/groups/${groupId}`);
  }

  // Get the amount current user owes to toUser (should be negative netAmount)
  const owedAmount =
    netAmounts[toUserId] < 0 ? Math.abs(netAmounts[toUserId]) : 0;

  res.render("user/pay-form", {
    pageTitle: "Pay Expense",
    isLoggedIn: req.session.isLoggedIn,
    user: req.session.user,
    groupId,
    toUser,
    owedAmount,
  });
};

exports.submitPaymentRequest = async (req, res) => {
  try {
    const { groupId, toUserId } = req.params;
    const fromUserId = req.session.user._id.toString();
    const { amount, mode } = req.body;

    // Check if group session is active
    const group = await Group.findById(groupId);
    if (group.status === "active") {
      req.session.message = {
        type: "error",
        text: 'Cannot make payments while group session is active. Wait for the session to be marked as "Ready to Settle".',
      };
      return res.redirect(`/user/groups/${groupId}/you-owe`);
    }

    const paymentRequest = new PaymentRequest({
      group: groupId,
      fromUser: fromUserId,
      toUser: toUserId,
      amount: Number(amount),
      mode,
      status: "pending",
    });

    await paymentRequest.save();
    res.redirect(`/user/groups/${groupId}/you-owe`);
  } catch (err) {
    console.error(err);
    res.redirect(`/user/groups/${req.params.groupId}/you-owe`);
  }
};

exports.listYouAreOwed = async (req, res) => {
  try {
    const user = req.user.username; // Adjust according to your auth
    const youAreOwedList = await Transaction.find({ receiver: user }).lean();
    res.render("you-are-owed", { youAreOwedList });
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

exports.approvePending = async (req, res) => {
  try {
    const { id } = req.body;
    const paymentRequest = await PaymentRequest.findById(id);

    if (!paymentRequest || paymentRequest.status !== "pending") {
      return res.status(400).send("Invalid payment request or not pending");
    }

    paymentRequest.status = "paid";
    await paymentRequest.save();

    // Redirect back to the you-are-owed page for the appropriate group
    res.redirect(`/user/groups/${paymentRequest.group}/you-are-owed`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

// Disapprove Pending
exports.disapprovePending = async (req, res) => {
  try {
    const { id } = req.body;
    const paymentRequest = await PaymentRequest.findById(id);

    if (!paymentRequest || paymentRequest.status !== "pending") {
      return res.status(400).send("Invalid payment request or not pending");
    }

    // Set status to 'not received' to indicate disapproval
    paymentRequest.status = "not received";
    await paymentRequest.save();

    res.redirect(`/user/groups/${paymentRequest.group}/you-are-owed`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

// Toggle Group Status (Active <-> Ready to Settle)
exports.toggleGroupStatus = async (req, res) => {
  try {
    const groupId = req.params.groupId;
    const currentUserId = req.session.user._id.toString();

    const group = await Group.findById(groupId);

    if (!group) {
      return res.status(404).send("Group not found");
    }

    // Only group creator can change status
    if (group.createdBy.toString() !== currentUserId) {
      return res.status(403).send("Only group creator can change group status");
    }

    // Toggle status
    group.status = group.status === "active" ? "ready_to_settle" : "active";
    await group.save();

    // Fire-and-forget Postgres sync for group status change
    if (
      process.env.DB_HOST ||
      process.env.DB_USER ||
      process.env.DB_NAME ||
      process.env.PG_HOST ||
      process.env.PG_USER ||
      process.env.PGDATABASE
    ) {
      pgSync
        .syncGroup(group)
        .then((ok) => {
          if (!ok)
            console.warn(
              "Group status changed in MongoDB but Postgres sync failed"
            );
        })
        .catch((e) =>
          console.warn(
            "Pg sync error for group (toggle status):",
            e && e.message ? e.message : e
          )
        );
    }

    res.redirect(`/user/groups/${groupId}`);
  } catch (error) {
    console.error(error);
    res.status(500).send("Server Error");
  }
};

// Profile management functions
const showEditProfile = async (req, res) => {
  if (!req.session.user || !req.session.isLoggedIn) {
    return res.redirect("/auth/login");
  }

  try {
    // Get fresh user data from database
    const user = await User.findById(req.session.user._id);
    if (!user) {
      return res.redirect("/auth/login");
    }

    res.render("user/edit-profile", {
      pageTitle: "Edit Profile",
      user: user,
      successMessage: req.query.success
        ? "Profile updated successfully!"
        : null,
      errorMessage: req.query.error || null,
    });
  } catch (error) {
    console.error("Error showing edit profile:", error);
    res.status(500).send("Server Error");
  }
};

exports.showEditProfile = showEditProfile;

const updateProfile = async (req, res) => {
  if (!req.session.user || !req.session.isLoggedIn) {
    return res.redirect("/auth/login");
  }

  try {
    const { firstName, lastName, email, phone, upiLink } = req.body;

    // Validate required fields (UPI is optional)
    if (!firstName || !lastName || !email || !phone) {
      return res.redirect(
        "/user/profile?error=" +
          encodeURIComponent(
            "First name, last name, email, and phone are required"
          )
      );
    }

    // Validate phone number format (accepts +91XXXXXXXXXX, +91 XXXXXXXXXX, or XXXXXXXXXX)
    // Remove all spaces and non-digit characters except +
    const cleanedPhone = phone.trim().replace(/\s+/g, "");
    const phoneRegex = /^(\+91)?[6-9]\d{9}$/;
    if (!phoneRegex.test(cleanedPhone)) {
      return res.redirect(
        "/user/profile?error=" +
          encodeURIComponent(
            "Phone number must be a valid Indian mobile number (10 digits or +91 followed by 10 digits)"
          )
      );
    }

    // Check if email is already taken by another user
    const existingUser = await User.findOne({
      email: email,
      _id: { $ne: req.session.user._id },
    });

    if (existingUser) {
      return res.redirect(
        "/user/profile?error=" + encodeURIComponent("Email is already taken")
      );
    }

    // Find the user to update
    const user = await User.findById(req.session.user._id);
    if (!user) {
      return res.redirect("/auth/login");
    }

    // Update user fields
    user.firstName = firstName.trim();
    user.lastName = lastName.trim();
    user.email = email.trim().toLowerCase();
    // Remove +91 prefix if present, store only 10 digits in database
    user.phone = cleanedPhone.replace(/^\+91/, "");
    user.upiLink = upiLink.trim();

    // Handle profile picture upload (req.file provided by S3 multer middleware)
    if (req.file) {
      // If previous image was on S3, attempt to delete it using stored key when present
      if (user.profilePicKey && bucketName) {
        try {
          const Key = user.profilePicKey;
          try {
            await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key }));
          } catch (e) {
            console.warn("S3 delete failed:", e.message || e);
          }
        } catch (e) {
          console.warn(
            "Error while removing previous profile image by key:",
            e.message || e
          );
        }
      } else if (user.profilePicUrl && typeof user.profilePicUrl === "string") {
        // Fallback: try to detect S3-hosted URL and extract object key
        try {
          const s3KeyMatch = user.profilePicUrl.match(/profile-images\/.+/);
          if (s3KeyMatch && bucketName) {
            const Key = s3KeyMatch[0];
            try {
              await s3.send(
                new DeleteObjectCommand({ Bucket: bucketName, Key })
              );
            } catch (e) {
              console.warn("S3 delete failed:", e.message || e);
            }
          } else {
            // Fallback: if stored as local path, remove local file
            const oldImagePath = path.join(
              __dirname,
              "..",
              "public",
              user.profilePicUrl
            );
            if (fs.existsSync(oldImagePath)) {
              fs.unlinkSync(oldImagePath);
            }
          }
        } catch (e) {
          console.warn(
            "Error while removing previous profile image:",
            e.message || e
          );
        }
      }

      // Set new profile picture URL — multer-s3 exposes `location`
      user.profilePicUrl =
        req.file.location ||
        req.file.path ||
        `/uploads/profiles/${req.file.filename}`;

      // store S3 object key when multer-s3 provides it (preferred)
      user.profilePicKey = req.file.key || null;

      // If no explicit key, try to extract from location for backward compatibility
      if (!user.profilePicKey && user.profilePicUrl) {
        const m = user.profilePicUrl.match(/profile-images\/.+/);
        if (m) user.profilePicKey = m[0];
      }
    }

    // Save updated user
    await user.save();

    // Fire-and-forget Postgres sync for updated user
    if (
      process.env.DB_HOST ||
      process.env.DB_USER ||
      process.env.DB_NAME ||
      process.env.PG_HOST ||
      process.env.PG_USER ||
      process.env.PGDATABASE
    ) {
      pgSync
        .syncUser(user)
        .then((ok) => {
          if (!ok)
            console.warn("User updated in MongoDB but Postgres sync failed");
        })
        .catch((e) =>
          console.warn(
            "Pg sync error for user (update):",
            e && e.message ? e.message : e
          )
        );
    }

    // Update session data
    req.session.user = user;

    res.redirect("/user/profile?success=1");
  } catch (error) {
    console.error("Error updating profile:", error);
    res.redirect(
      "/user/profile?error=" + encodeURIComponent("Failed to update profile")
    );
  }
};

exports.updateProfile = updateProfile;

const removeProfilePicture = async (req, res) => {
  if (!req.session.user || !req.session.isLoggedIn) {
    return res.redirect("/auth/login");
  }

  try {
    const user = await User.findById(req.session.user._id);
    if (!user) {
      return res.redirect("/auth/login");
    }

    if (user.profilePicUrl || user.profilePicKey) {
      // prefer stored key for deletion
      try {
        if (user.profilePicKey && bucketName) {
          const Key = user.profilePicKey;
          try {
            await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key }));
          } catch (e) {
            console.warn("S3 delete failed:", e.message || e);
          }
        } else if (user.profilePicUrl) {
          // fallback to detect S3-hosted URL and extract object key
          const s3KeyMatch = user.profilePicUrl.match(/profile-images\/.+/);
          if (s3KeyMatch && bucketName) {
            const Key = s3KeyMatch[0];
            try {
              await s3.send(
                new DeleteObjectCommand({ Bucket: bucketName, Key })
              );
            } catch (e) {
              console.warn("S3 delete failed:", e.message || e);
            }
          } else {
            // fallback to local file deletion
            const imagePath = path.join(
              __dirname,
              "..",
              "public",
              user.profilePicUrl
            );
            if (fs.existsSync(imagePath)) {
              fs.unlinkSync(imagePath);
            }
          }
        }
      } catch (e) {
        console.warn("Error deleting previous profile image:", e.message || e);
      }

      user.profilePicUrl = null;
      user.profilePicKey = null;
      await user.save();
      req.session.user = user;
      // Fire-and-forget Postgres sync for updated user (profile pic removed)
      if (
        process.env.PG_HOST ||
        process.env.PG_USER ||
        process.env.PGDATABASE
      ) {
        pgSync
          .syncUser(user)
          .then((ok) => {
            if (!ok)
              console.warn(
                "User profile pic removed in MongoDB but Postgres sync failed"
              );
          })
          .catch((e) =>
            console.warn(
              "Pg sync error for user (removeProfilePicture):",
              e && e.message ? e.message : e
            )
          );
      }
    }

    res.redirect("/user/profile?success=1");
  } catch (error) {
    console.error("Error removing profile picture:", error);
    res.redirect(
      "/user/profile?error=" +
        encodeURIComponent("Failed to remove profile picture")
    );
  }
};

exports.removeProfilePicture = removeProfilePicture;

exports.uploadProfilePicture = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const imageUrl = req.file.location;

    const update = { profilePicUrl: imageUrl };
    if (req.file.key) update.profilePicKey = req.file.key;
    else {
      const m = imageUrl && imageUrl.match(/profile-images\/.+/);
      if (m) update.profilePicKey = m[0];
    }

    await User.findByIdAndUpdate(req.session.user._id, update);

    // Fetch updated user and async-sync to Postgres
    try {
      const updatedUser = await User.findById(req.session.user._id);
      // Update session copy
      req.session.user.profilePicUrl = update.profilePicUrl;
      req.session.user.profilePicKey = update.profilePicKey || null;

      if (
        process.env.PG_HOST ||
        process.env.PG_USER ||
        process.env.PGDATABASE
      ) {
        pgSync
          .syncUser(updatedUser)
          .then((ok) => {
            if (!ok)
              console.warn(
                "User uploaded profile pic in MongoDB but Postgres sync failed"
              );
          })
          .catch((e) =>
            console.warn(
              "Pg sync error for user (uploadProfilePicture):",
              e && e.message ? e.message : e
            )
          );
      }
    } catch (e) {
      console.warn(
        "Could not fetch updated user for pg sync:",
        e && e.message ? e.message : e
      );
    }

    res.redirect("/user/profile?success=1");
  } catch (error) {
    console.error("Error uploading profile picture:", error);
    res.redirect("/user/profile?error=UploadFailed");
  }
};
