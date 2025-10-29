/**
 * normalizeExpensesForLambda Lambda (CORRECTED)
 *
 * Input:
 * {
 *   "rawExpenses": [
 *     {
 *       "id": "e1",
 *       "amount": 120.50,
 *       "paidBy": [{ userId: "u1" }],  // Can omit amount, will default to full expense
 *       "splitType": "equal",           // "equal" | "unequal" (exact amounts)
 *       "members": ["u1","u2","u3"],    // Required for equal split
 *       "exact": { "u1": 40.17, "u2": 40.17, "u3": 40.16 } // For unequal/exact split
 *     }
 *   ]
 * }
 *
 * Output:
 * {
 *   "expenses": [
 *     {
 *       "id": "e1",
 *       "amount": 120.50,
 *       "paidBy": [{ "userId": "u1", "amount": 120.50 }],
 *       "splits": [
 *         { "userId": "u1", "amount": 40.17 },
 *         { "userId": "u2", "amount": 40.17 },
 *         { "userId": "u3", "amount": 40.16 }
 *       ]
 *     }
 *   ]
 * }
 */

const toCents = (n) => Math.round(Number(n) * 100);

function distributeRemainder(totalCents, count) {
  // Distribute totalCents evenly across count people, handling remainders fairly
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;

  const amounts = [];
  for (let i = 0; i < count; i++) {
    amounts.push(base + (i < remainder ? 1 : 0));
  }
  return amounts;
}

export const handler = async (event) => {
  try {
    const payload =
      typeof event.body === "string" ? JSON.parse(event.body) : event;
    const raw = payload.rawExpenses || [];
    const out = [];

    for (const ex of raw) {
      const amountCents = toCents(ex.amount);

      // Normalize paidBy
      let paidBy = ex.paidBy || [];
      if (paidBy.length === 0) {
        // No payer specified - use first member
        const payer = (ex.members && ex.members[0]) || null;
        if (!payer) {
          console.warn("Expense has no payer or members:", ex);
          continue;
        }
        paidBy = [{ userId: payer, amount: ex.amount }];
      } else {
        // Ensure paidBy amounts sum to total
        let paidSum = paidBy.reduce((s, p) => s + toCents(p.amount || 0), 0);

        if (paidSum === 0) {
          // No amounts specified - assume first payer paid everything
          paidBy = [{ userId: paidBy[0].userId, amount: ex.amount }];
        } else if (paidSum !== amountCents) {
          // Normalize proportionally to match total
          const scale = amountCents / paidSum;
          let sum = 0;
          const normalized = paidBy.map((p) => {
            const cents = Math.round(toCents(p.amount || 0) * scale);
            sum += cents;
            return { userId: p.userId, amount: cents / 100 };
          });

          // Fix rounding difference
          const diff = amountCents - sum;
          if (diff !== 0 && normalized.length > 0) {
            normalized[0].amount += diff / 100;
          }
          paidBy = normalized;
        } else {
          // Already correct sum, just ensure amounts are set
          paidBy = paidBy.map((p) => ({
            userId: p.userId,
            amount:
              p.amount !== undefined && p.amount !== null
                ? Number(p.amount)
                : 0,
          }));
        }
      }

      // Normalize splits
      let splits = [];
      const type = ex.splitType || "equal";

      if (type === "equal") {
        const members = ex.members || paidBy.map((p) => p.userId);
        if (members.length === 0) {
          console.warn("Equal split with no members:", ex);
          continue;
        }

        const splitCents = distributeRemainder(amountCents, members.length);
        splits = members.map((userId, i) => ({
          userId,
          amount: splitCents[i] / 100,
        }));
      } else if (type === "unequal" || type === "exact") {
        // Exact amounts specified in ex.exact map
        const exactMap = ex.exact || {};
        const keys = Object.keys(exactMap);

        if (keys.length === 0) {
          console.warn("Unequal split with no exact amounts:", ex);
          continue;
        }

        // Convert to cents and ensure sum matches total
        let sum = 0;
        const splitCents = keys.map((k) => {
          const cents = toCents(exactMap[k]);
          sum += cents;
          return { userId: k, cents };
        });

        // Adjust first split if there's a rounding difference
        const diff = amountCents - sum;
        if (diff !== 0 && splitCents.length > 0) {
          splitCents[0].cents += diff;
        }

        splits = splitCents.map((s) => ({
          userId: s.userId,
          amount: s.cents / 100,
        }));
      } else {
        // Fallback to equal split
        const members = ex.members || paidBy.map((p) => p.userId);
        const splitCents = distributeRemainder(amountCents, members.length);
        splits = members.map((userId, i) => ({
          userId,
          amount: splitCents[i] / 100,
        }));
      }

      out.push({
        id: ex.id || null,
        amount: ex.amount,
        paidBy,
        splits,
      });
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ expenses: out }),
    };
  } catch (err) {
    console.error("normalizeExpensesForLambda error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: String(err) }),
    };
  }
};
