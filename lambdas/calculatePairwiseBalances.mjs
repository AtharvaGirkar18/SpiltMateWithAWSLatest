/**
 * calculatePairwiseBalances Lambda
 *
 * Tracks balances between each pair of users (who owes whom exactly)
 * This is needed to show accurate "T owes A ₹500" relationships
 *
 * Input:
 * {
 *   "expenses": [
 *     {
 *       "amount": 2000,
 *       "paidBy": [{ "userId": "A", "amount": 2000 }],
 *       "splits": [
 *         { "userId": "A", "amount": 1000 },
 *         { "userId": "S", "amount": 500 },
 *         { "userId": "T", "amount": 500 }
 *       ]
 *     }
 *   ],
 *   "members": ["A", "S", "T"],
 *   "paymentRequests": []
 * }
 *
 * Output:
 * {
 *   "pairwiseBalances": {
 *     "A->S": 500,  // A is owed ₹500 by S
 *     "A->T": 500,  // A is owed ₹500 by T
 *     "S->T": 0     // S doesn't owe T anything
 *   },
 *   "userBalances": {
 *     "A": { "youAreOwed": 1000, "youOwe": 0, "net": 1000 },
 *     "S": { "youAreOwed": 0, "youOwe": 500, "net": -500 },
 *     "T": { "youAreOwed": 0, "youOwe": 500, "net": -500 }
 *   }
 * }
 */

const toRupees = (n) => Number(Number(n).toFixed(2));

// Create a consistent key for a pair of users (always alphabetically sorted)
const getPairKey = (userId1, userId2) => {
  return userId1 < userId2
    ? `${userId1}->${userId2}`
    : `${userId2}->${userId1}`;
};

// Get the signed balance for a specific direction
const getDirectedBalance = (pairBalances, from, to) => {
  const key = getPairKey(from, to);
  const balance = pairBalances[key] || 0;

  // If key is "from->to", positive balance means 'to' owes 'from'
  // If key is "to->from", positive balance means 'from' owes 'to'
  if (key === `${from}->${to}`) {
    return balance; // Positive = 'to' owes 'from'
  } else {
    return -balance; // Negative = 'from' owes 'to'
  }
};

// Set the directed balance
const setDirectedBalance = (pairBalances, from, to, amount) => {
  const key = getPairKey(from, to);

  if (key === `${from}->${to}`) {
    pairBalances[key] = amount;
  } else {
    pairBalances[key] = -amount;
  }
};

export const handler = async (event) => {
  try {
    const payload =
      typeof event.body === "string" ? JSON.parse(event.body) : event;
    const expenses = payload.expenses || [];
    const paymentRequests = payload.paymentRequests || [];
    const members = payload.members || [];

    // Track balances between each pair
    const pairBalances = {}; // "userId1->userId2" -> rupees (positive = userId2 owes userId1)

    // Process each expense
    for (const expense of expenses) {
      if (!Array.isArray(expense.paidBy) || !Array.isArray(expense.splits)) {
        console.warn("Skipping malformed expense:", expense);
        continue;
      }

      // For each expense, track who paid vs who owes
      // If A pays ₹2000 and S owes ₹500, then S owes A ₹500

      for (const payer of expense.paidBy) {
        const payerId = payer.userId;
        const paidAmount = toRupees(payer.amount || 0);

        for (const split of expense.splits) {
          const borrowerId = split.userId;
          const owedAmount = toRupees(split.amount || 0);

          if (payerId === borrowerId) {
            // Same person - they paid for their own share, no debt
            continue;
          }

          // borrower owes payer this amount
          const currentBalance = getDirectedBalance(
            pairBalances,
            payerId,
            borrowerId
          );
          const newBalance = toRupees(currentBalance + owedAmount);
          setDirectedBalance(pairBalances, payerId, borrowerId, newBalance);
        }
      }
    }

    // Apply paid payment requests
    // When S pays A ₹333.33, reduce the amount S owes A
    for (const pr of paymentRequests) {
      if (pr.status === "paid") {
        const amount = toRupees(pr.amount || 0);
        const from = pr.from || pr.fromUser; // Person who paid
        const to = pr.to || pr.toUser; // Person who received payment

        if (from && to && amount > 0) {
          // Reduce the debt: from owes to less now
          const currentBalance = getDirectedBalance(pairBalances, to, from);
          const newBalance = toRupees(currentBalance - amount);
          setDirectedBalance(pairBalances, to, from, newBalance);
        }
      }
    }

    // Calculate per-user summary
    const userBalances = {};
    members.forEach((userId) => {
      userBalances[userId] = {
        youAreOwed: 0,
        youOwe: 0,
        net: 0,
      };
    });

    // Sum up all pairwise balances for each user
    for (const [pairKey, balance] of Object.entries(pairBalances)) {
      const [user1, user2] = pairKey.split("->");

      if (balance > 0) {
        // user2 owes user1
        userBalances[user1].youAreOwed = toRupees(
          userBalances[user1].youAreOwed + balance
        );
        userBalances[user2].youOwe = toRupees(
          userBalances[user2].youOwe + balance
        );
      } else if (balance < 0) {
        // user1 owes user2
        userBalances[user2].youAreOwed = toRupees(
          userBalances[user2].youAreOwed + Math.abs(balance)
        );
        userBalances[user1].youOwe = toRupees(
          userBalances[user1].youOwe + Math.abs(balance)
        );
      }
    }

    // Calculate net for each user
    for (const userId in userBalances) {
      const { youAreOwed, youOwe } = userBalances[userId];
      userBalances[userId].net = toRupees(youAreOwed - youOwe);
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        pairwiseBalances: pairBalances,
        userBalances: userBalances,
      }),
    };
  } catch (err) {
    console.error("calculatePairwiseBalances error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
