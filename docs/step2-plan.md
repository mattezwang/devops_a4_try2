# SplitTab — Step 2 Implementation Plan

**Reads from:** `docs/step2-specify.md`, `docs/step2-review.md` (addendum §3 takes precedence), and existing step-1 codebase.  
**Scope of this document:** Plan only. No application code is written here.

---

## 1. File-by-File Diff Plan

### `src/db.js` — change

- Append four DDL statements to the existing `db.exec()` string (before the closing backtick): `CREATE TABLE IF NOT EXISTS settlements`, and three `CREATE INDEX IF NOT EXISTS` statements on `settlements(group_id)`, `settlements(from_member_id)`, `settlements(to_member_id)`.
- After the `db.exec()` call, add the `PRAGMA table_info` guard (addendum A1) to idempotently `ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'`.

### `src/balances.js` — change

- Add `computePercentageSplits(totalCents, splits)` — new function implementing the percentage-to-cents rounding algorithm from spec §3.3 and addendum A4.
- Extend the existing `computeBalances(members, expenses)` signature to `computeBalances(members, expenses, settlements = [])` — adds the settled_out/settled_in terms from spec §5.2. Existing callers (which pass no settlements) remain unaffected via the default.
- Add `balanceStringToCents(str)` — private helper that parses `centsToString` output back to a signed integer (e.g. `"-7.33"` → `-733`). Used only by `simplifyDebts`.
- Add `simplifyDebts(membersWithBalances)` — implements the greedy debt-simplification algorithm from spec §4.1. Input is the array returned by `computeBalances`.
- Update `module.exports` to include `computePercentageSplits` and `simplifyDebts`.

### `src/routes/groups.js` — change

- **`POST /api/groups/:id/expenses`**: destructure `split_type` and `splits` from `req.body`; implement the full validation order from addendum A3; branch on split_type to call `computeSplits` (equal), use validated splits directly (exact), or call `computePercentageSplits` (percentage); update the SQL INSERT to include the `split_type` column; include `split_type` in the 201 response; re-sort response splits by member_id ASC before building the response.
- **`GET /api/groups/:id`**: add `split_type` to the expenses SELECT query; include `split_type` in each expense object in the `expenses` array; query the `settlements` table for the group; pass settlements to `computeBalances`; call `simplifyDebts` to build `suggested_settlements`; build a `feed` array by merging expense and settlement items, sorting per spec §6.4.

### `src/routes/expenses.js` — no change

`DELETE /api/expenses/:id` is unchanged.

### `src/routes/settlements.js` — new file

Full responsibility: owns all settlement-related API endpoints.

- `GET /api/groups/:id/settlements/suggested` — fetch members + expense splits + settlements, compute balances, run simplifyDebts, return `{ suggested_settlements: [...] }`.
- `POST /api/groups/:id/settlements` — validate group, from_member_id, to_member_id, self-settlement, amount; INSERT into settlements; return 201 with full settlement object.
- `DELETE /api/settlements/:id` — 404 if not found, DELETE row, return `{ deleted: true, settlement_id }`.

### `src/index.js` — change

- `require('./routes/settlements')` and register it with `app.use('/api', settlementsRouter)` after the existing `app.use('/api', expensesRouter)` line.

### `src/routes/pages.js` — change

- `groupPage(group)`: receives extended group data (now includes `suggested_settlements` and `feed`); replace the "Expenses" `<h2>` and `#expense-list` with an "Activity" `<h2>` and `#activity-list` rendered from `group.feed`; add a "Suggested Settlements" section between the Balances table and Activity section; add a "Record a Payment" form; update the Add Expense form with a split-type selector and conditional sub-field panels; update all client-side JS for the new interactions.

### `public/style.css` — change

- Add `.activity-item` (same flex layout as existing `.expense-item`).
- Add `.settlement-tag` for the `[settlement]` label badge.
- Add `.suggested-settlements` section and `.settlement-suggestion` line item.
- Add `.record-payment` form section.

---

## 2. Schema Migration Plan

### Exact changes to `src/db.js`

**Step A — Append to the existing `db.exec()` string** (insert before the closing backtick on line 40):

```sql
  CREATE TABLE IF NOT EXISTS settlements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id       INTEGER NOT NULL REFERENCES groups(id),
    from_member_id INTEGER NOT NULL REFERENCES members(id),
    to_member_id   INTEGER NOT NULL REFERENCES members(id),
    amount         INTEGER NOT NULL,
    created_at     TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_settlements_group_id    ON settlements(group_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_from_member ON settlements(from_member_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_to_member   ON settlements(to_member_id);
```

These statements are all `CREATE … IF NOT EXISTS` and are idempotent — safe to run on every startup.

**Step B — Add PRAGMA guard after `db.exec()`** (after line 40, before `module.exports`):

```js
// Idempotent migration: add split_type column if not present (addendum A1)
const expenseCols = db.prepare('PRAGMA table_info(expenses)').all();
if (!expenseCols.some(c => c.name === 'split_type')) {
  db.exec("ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'");
}
```

This is safe on first run (column absent → ALTER runs), and on all subsequent runs (column present → ALTER is skipped). No try/catch needed.

---

## 3. New/Changed Pure Functions in `src/balances.js`

Following the existing code style: `'use strict'`, named functions, throws are `{ status, message }` objects, no class syntax.

### `computePercentageSplits(totalCents, splits)` — new

```
// Input:
//   totalCents: integer (expense amount in cents)
//   splits: array of { memberId: number, percentage: number }
//           (already validated: percentages > 0, sum ≈ 100.00)
// Returns: array of { memberId, shareCents } — NOT yet sorted by memberId

function computePercentageSplits(totalCents, splits) {
  // Step 1: sort by percentage DESC, then memberId ASC for ties
  const sorted = [...splits].sort((a, b) =>
    b.percentage !== a.percentage
      ? b.percentage - a.percentage
      : a.memberId - b.memberId
  );

  // Step 2: compute floor amounts
  const withFloor = sorted.map(s => ({
    memberId: s.memberId,
    floorCents: Math.floor(totalCents * s.percentage / 100),
    percentage: s.percentage,
  }));

  // Step 3: compute remainder
  const totalFloor = withFloor.reduce((acc, s) => acc + s.floorCents, 0);
  let remainder = totalCents - totalFloor;

  // Addendum A4: defensive clamp — prevents misbehavior on pathological IEEE 754 inputs
  remainder = Math.max(0, Math.min(remainder, withFloor.length));

  // Step 4: distribute remainder (+1 cent to the first `remainder` entries in sorted order)
  return withFloor.map((s, i) => ({
    memberId: s.memberId,
    shareCents: s.floorCents + (i < remainder ? 1 : 0),
  }));
  // Invariant: SUM(shareCents) === totalCents
}
```

Callers re-sort by `memberId ASC` before building the DB inserts and the JSON response (per spec §3.4).

### `computeBalances(members, expenses, settlements = [])` — extend existing

Current signature: `computeBalances(members, expenses)`. Extend to accept an optional third argument. Existing callers pass no third argument and get identical behavior (empty settlements → no change).

```
// members:    [{ id, name }]
// expenses:   [{ amount, paid_by, splits: [{ member_id, share_amount }] }]
// settlements:[{ from_member_id, to_member_id, amount }]  (cents integers)
// Returns:    [{ id, name, balance: string }]

function computeBalances(members, expenses, settlements = []) {
  const paidMap      = {};
  const owedMap      = {};
  const settledOutMap = {};
  const settledInMap  = {};

  for (const m of members) {
    paidMap[m.id]       = 0;
    owedMap[m.id]       = 0;
    settledOutMap[m.id] = 0;
    settledInMap[m.id]  = 0;
  }

  for (const expense of expenses) {
    paidMap[expense.paid_by] += expense.amount;
    for (const split of expense.splits) {
      owedMap[split.member_id] += split.share_amount;
    }
  }

  for (const s of settlements) {
    settledOutMap[s.from_member_id] += s.amount;
    settledInMap[s.to_member_id]    += s.amount;
  }

  return members.map(m => ({
    id:      m.id,
    name:    m.name,
    balance: centsToString(
      paidMap[m.id] - owedMap[m.id] + settledOutMap[m.id] - settledInMap[m.id]
    ),
  }));
}
```

### `balanceStringToCents(str)` — new private helper

Parses `centsToString` output back to a signed integer. Only used internally by `simplifyDebts`.

```
function balanceStringToCents(str) {
  // str is the output of centsToString: e.g. "14.66", "-7.33", "0.00"
  const neg = str.startsWith('-');
  const abs = neg ? str.slice(1) : str;
  const [d, c] = abs.split('.');
  return (parseInt(d, 10) * 100 + parseInt(c, 10)) * (neg ? -1 : 1);
}
```

Not exported.

### `simplifyDebts(membersWithBalances)` — new

```
// Input:  array returned by computeBalances — [{ id, name, balance: string }]
// Output: [{ from: { id, name }, to: { id, name }, amount: string }]
//         Transactions that zero all balances (greedy, spec §4.1).

function simplifyDebts(membersWithBalances) {
  // Build mutable working lists with signed cents
  const credits = [];
  const debts   = [];
  for (const m of membersWithBalances) {
    const cents = balanceStringToCents(m.balance);
    if (cents > 0) credits.push({ id: m.id, name: m.name, balanceCents: cents });
    if (cents < 0) debts.push({   id: m.id, name: m.name, balanceCents: cents });
  }

  const transactions = [];

  while (credits.length > 0 && debts.length > 0) {
    // Largest creditor: highest balanceCents, tie → lowest id
    credits.sort((a, b) =>
      b.balanceCents !== a.balanceCents ? b.balanceCents - a.balanceCents : a.id - b.id
    );
    // Largest debtor by magnitude: most negative balanceCents, tie → lowest id
    debts.sort((a, b) =>
      a.balanceCents !== b.balanceCents ? a.balanceCents - b.balanceCents : a.id - b.id
    );

    const C = credits[0];
    const D = debts[0];
    const amount = Math.min(C.balanceCents, -D.balanceCents);  // always > 0

    transactions.push({
      from:   { id: D.id, name: D.name },
      to:     { id: C.id, name: C.name },
      amount: centsToString(amount),
    });

    C.balanceCents -= amount;
    D.balanceCents += amount;

    if (C.balanceCents === 0) credits.shift();
    if (D.balanceCents === 0) debts.shift();
  }

  return transactions;
}
```

---

## 4. Endpoint-to-File Mapping

| Method | Path | File | Notes |
|---|---|---|---|
| `POST` | `/api/groups/:id/expenses` | `src/routes/groups.js` | Existing handler, extended for split_type |
| `GET` | `/api/groups/:id` | `src/routes/groups.js` | Existing handler, extended with settlements + feed |
| `GET` | `/api/groups/:id/settlements/suggested` | `src/routes/settlements.js` | New |
| `POST` | `/api/groups/:id/settlements` | `src/routes/settlements.js` | New |
| `DELETE` | `/api/settlements/:id` | `src/routes/settlements.js` | New |

`DELETE /api/expenses/:id` in `src/routes/expenses.js` is **unchanged**.

---

## 5. HTML Page Changes (`src/routes/pages.js` → `groupPage()`)

### 5a. Add-Expense Form

Replace the existing `<div class="form-group"><label>Split between</label>...` block with:

1. **Split type selector** added after the "Paid by" row:
   ```html
   <div class="form-group">
     <label for="exp-split-type">Split type</label>
     <select id="exp-split-type">
       <option value="equal">Equal</option>
       <option value="exact">Exact amounts</option>
       <option value="percentage">Percentage</option>
     </select>
   </div>
   ```

2. **Equal panel** (shown by default, hidden for other types):
   ```html
   <div id="panel-equal" class="form-group">
     <label>Split between</label>
     <div class="checkboxes">${splitCheckboxes}</div>
   </div>
   ```

3. **Exact panel** (hidden by default):
   ```html
   <div id="panel-exact" class="form-group" style="display:none">
     <label>Exact amounts ($)</label>
     ${members.map(m => `
       <div class="split-row">
         <label>${escapeHtml(m.name)}</label>
         <input type="text" class="exact-amount" data-member-id="${m.id}" placeholder="0.00">
       </div>`).join('')}
   </div>
   ```

4. **Percentage panel** (hidden by default):
   ```html
   <div id="panel-pct" class="form-group" style="display:none">
     <label>Percentages (%)</label>
     ${members.map(m => `
       <div class="split-row">
         <label>${escapeHtml(m.name)}</label>
         <input type="number" class="pct-amount" data-member-id="${m.id}" step="0.01" min="0.01" placeholder="0">
       </div>`).join('')}
   </div>
   ```

5. **JS for split type show/hide**: `document.getElementById('exp-split-type').addEventListener('change', ...)` toggles panel visibility.

6. **Form submit JS** updated: reads split_type value; for equal → uses checked checkboxes as `split_between`; for exact → builds `splits: [{ member_id, amount }]` array; for percentage → builds `splits: [{ member_id, percentage }]` array; always sends `split_type` field.

### 5b. Suggested Settlements Section

Rendered server-side, inserted between the Balances table and the Activity section.

```html
<h2>Suggested Settlements</h2>
<div id="suggested-settlements">
  <!-- when group.suggested_settlements.length === 0: -->
  <p class="empty-state">All balances are settled — no payments needed.</p>

  <!-- when non-empty: one item per suggestion -->
  <div class="settlement-suggestion">
    ${name} pays ${name} <strong>$${amount}</strong>
    <button class="record-suggestion-btn"
            data-from="${s.from.id}"
            data-to="${s.to.id}"
            data-amount="${s.amount}">
      Record this payment
    </button>
  </div>
```

JS: `document.querySelectorAll('.record-suggestion-btn').forEach(btn => btn.addEventListener('click', async () => { POST /api/groups/${group.id}/settlements; reload on 201 }))`.

### 5c. Record a Payment Form

Below the Suggested Settlements section:

```html
<h2>Record a Payment</h2>
<form id="record-payment-form">
  <div class="form-group">
    <label for="pay-from">Who paid</label>
    <select id="pay-from">${memberOptions}</select>
  </div>
  <div class="form-group">
    <label for="pay-to">Who received</label>
    <select id="pay-to">${memberOptions}</select>
  </div>
  <div class="form-group">
    <label for="pay-amount">Amount ($)</label>
    <input type="text" id="pay-amount" placeholder="7.33">
  </div>
  <button type="submit">Record Payment</button>
  <p id="payment-error" class="error" style="display:none"></p>
</form>
```

JS: submit handler POSTs `{ from_member_id, to_member_id, amount }` to `/api/groups/${group.id}/settlements`; reloads on 201; shows error on failure.

### 5d. Activity Feed (replaces "Expenses" section)

Replace the `<h2>Expenses</h2><div id="expense-list">...</div>` block with:

```html
<h2>Activity</h2>
<div id="activity-list">
  <!-- empty state -->
  <p class="empty-state">No activity yet.</p>

  <!-- expense feed item -->
  <div class="activity-item">
    <div class="expense-info">
      <strong>${description}</strong> — $${amount}
      paid by <em>${paid_by.name}</em>
      split between: ${splits names}
    </div>
    <button class="delete-btn" data-expense-id="${id}">Delete</button>
  </div>

  <!-- settlement feed item -->
  <div class="activity-item">
    <div class="expense-info">
      ${from_member.name} paid ${to_member.name} <strong>$${amount}</strong>
      <span class="settlement-tag">[settlement]</span>
    </div>
    <button class="delete-btn" data-settlement-id="${id}">Delete</button>
  </div>
</div>
```

JS: update the delete button handler to check `data-expense-id` vs `data-settlement-id` and call the appropriate endpoint (`DELETE /api/expenses/:id` or `DELETE /api/settlements/:id`).

---

## 6. Extended Smoke Test Plan

**Decision: extend `test/smoke.sh`** (not create `test/smoke2.sh`).

Rationale: the definition of done requires the full step-1 + step-2 suite to exit 0 together. One file means one command; server lifecycle is shared; step-1 assertions always run before step-2 assertions. The existing step-1 assertions do not need to change — step-2 tests begin after the step-1 cleanup (expense deleted, all balances zero), then re-add expenses as needed.

Append the following after the last `echo "All smoke tests passed!"` / `exit 0` block (replace that final block to allow continuation):

```bash
# ============================================================
# Step-2 assertions (server still running, group still exists)
# At this point: all three step-1 expenses were deleted → balances all 0.00
# ============================================================

# S2-1: Backward-compat — equal-split without split_type field still works
echo ""
echo "=== Step-2 assertions ==="
echo "S2-1: equal-split, no split_type field (backward compat)..."
EQ_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Groceries\",\"amount\":\"22.00\",\"paid_by\":$ALICE_ID,\"split_between\":[$ALICE_ID,$BOB_ID,$CAROL_ID]}")
EQ_BODY=$(echo "$EQ_RESP" | sed -n '1p')
EQ_CODE=$(echo "$EQ_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$EQ_CODE" = "201" ] && echo "PASS: S2-1 returns 201" || { echo "FAIL: S2-1 expected 201 got $EQ_CODE"; exit 1; }
EQ_SPLIT_TYPE=$(echo "$EQ_BODY" | jq -r '.split_type')
[ "$EQ_SPLIT_TYPE" = "equal" ] && echo "PASS: S2-1 split_type is equal" || { echo "FAIL: S2-1 split_type expected equal got $EQ_SPLIT_TYPE"; exit 1; }
EQ_EXPENSE_ID=$(echo "$EQ_BODY" | jq -r '.id')

# S2-2: Exact split expense — shares must match input exactly
echo "S2-2: exact split (Alice $10.00, Bob $20.00 of $30.00)..."
EXACT_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Dinner\",\"amount\":\"30.00\",\"paid_by\":$ALICE_ID,\"split_type\":\"exact\",\"splits\":[{\"member_id\":$ALICE_ID,\"amount\":\"10.00\"},{\"member_id\":$BOB_ID,\"amount\":\"20.00\"}]}")
EXACT_BODY=$(echo "$EXACT_RESP" | sed -n '1p')
EXACT_CODE=$(echo "$EXACT_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$EXACT_CODE" = "201" ] && echo "PASS: S2-2 returns 201" || { echo "FAIL: S2-2 expected 201 got $EXACT_CODE"; exit 1; }
ALICE_EXACT=$(echo "$EXACT_BODY" | jq -r ".splits[] | select(.member_id==$ALICE_ID) | .share_amount")
BOB_EXACT=$(echo "$EXACT_BODY" | jq -r ".splits[] | select(.member_id==$BOB_ID) | .share_amount")
[ "$ALICE_EXACT" = "10.00" ] && echo "PASS: S2-2 Alice share is 10.00" || { echo "FAIL: S2-2 Alice expected 10.00 got $ALICE_EXACT"; exit 1; }
[ "$BOB_EXACT" = "20.00" ]   && echo "PASS: S2-2 Bob share is 20.00"   || { echo "FAIL: S2-2 Bob expected 20.00 got $BOB_EXACT"; exit 1; }
EXACT_EXPENSE_ID=$(echo "$EXACT_BODY" | jq -r '.id')

# S2-3: Percentage split — 33.33/33.33/33.34 rounding case (review §1 worked example)
# $10.00 = 1000 cents: Carol (33.34%, highest %) → 334c ($3.34);
# Alice and Bob both 33.33%, Alice has lower ID → both get 333c ($3.33)
echo "S2-3: percentage split 33.33/33.33/33.34 on \$10.00..."
PCT_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/expenses" \
  -H "Content-Type: application/json" \
  -d "{\"description\":\"Rent\",\"amount\":\"10.00\",\"paid_by\":$ALICE_ID,\"split_type\":\"percentage\",\"splits\":[{\"member_id\":$ALICE_ID,\"percentage\":33.33},{\"member_id\":$BOB_ID,\"percentage\":33.33},{\"member_id\":$CAROL_ID,\"percentage\":33.34}]}")
PCT_BODY=$(echo "$PCT_RESP" | sed -n '1p')
PCT_CODE=$(echo "$PCT_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$PCT_CODE" = "201" ] && echo "PASS: S2-3 returns 201" || { echo "FAIL: S2-3 expected 201 got $PCT_CODE"; exit 1; }
ALICE_PCT=$(echo "$PCT_BODY" | jq -r ".splits[] | select(.member_id==$ALICE_ID) | .share_amount")
BOB_PCT=$(echo "$PCT_BODY" | jq -r ".splits[] | select(.member_id==$BOB_ID) | .share_amount")
CAROL_PCT=$(echo "$PCT_BODY" | jq -r ".splits[] | select(.member_id==$CAROL_ID) | .share_amount")
[ "$ALICE_PCT" = "3.33" ]  && echo "PASS: S2-3 Alice share is 3.33"  || { echo "FAIL: S2-3 Alice expected 3.33 got $ALICE_PCT"; exit 1; }
[ "$BOB_PCT" = "3.33" ]    && echo "PASS: S2-3 Bob share is 3.33"    || { echo "FAIL: S2-3 Bob expected 3.33 got $BOB_PCT"; exit 1; }
[ "$CAROL_PCT" = "3.34" ]  && echo "PASS: S2-3 Carol share is 3.34"  || { echo "FAIL: S2-3 Carol expected 3.34 got $CAROL_PCT"; exit 1; }
PCT_EXPENSE_ID=$(echo "$PCT_BODY" | jq -r '.id')

# Clean up: delete exact and pct expenses; keep EQ_EXPENSE_ID ($22.00 grocery) for balance tests
curl -s -X DELETE "$BASE_URL/api/expenses/$EXACT_EXPENSE_ID" > /dev/null
curl -s -X DELETE "$BASE_URL/api/expenses/$PCT_EXPENSE_ID" > /dev/null

# S2-4: Suggested settlements with 3 members after $22.00 expense paid by Alice
# Expected: Bob→Alice $7.33, Carol→Alice $7.33  (per spec §4.2 worked example)
echo "S2-4: suggested settlements for 3-member group (\$22.00 grocery by Alice)..."
SUGG=$(curl -s "$BASE_URL/api/groups/$GROUP_ID/settlements/suggested")
SUGG_COUNT=$(echo "$SUGG" | jq '.suggested_settlements | length')
[ "$SUGG_COUNT" = "2" ] && echo "PASS: S2-4 suggested_settlements count is 2" || { echo "FAIL: S2-4 expected 2 got $SUGG_COUNT"; exit 1; }
BOB_PAYS=$(echo "$SUGG" | jq -r ".suggested_settlements[] | select(.from.id==$BOB_ID and .to.id==$ALICE_ID) | .amount")
CAROL_PAYS=$(echo "$SUGG" | jq -r ".suggested_settlements[] | select(.from.id==$CAROL_ID and .to.id==$ALICE_ID) | .amount")
[ "$BOB_PAYS" = "7.33" ]   && echo "PASS: S2-4 Bob pays Alice 7.33"   || { echo "FAIL: S2-4 Bob→Alice expected 7.33 got $BOB_PAYS"; exit 1; }
[ "$CAROL_PAYS" = "7.33" ] && echo "PASS: S2-4 Carol pays Alice 7.33" || { echo "FAIL: S2-4 Carol→Alice expected 7.33 got $CAROL_PAYS"; exit 1; }
# Verify the two amounts sum to Alice's credit (7.33+7.33=14.66): structural zero-sum check
TOTAL_SUGG=$(echo "$SUGG" | jq '[.suggested_settlements[].amount | tonumber] | add')
echo "$TOTAL_SUGG" | grep -qF "14.66" && echo "PASS: S2-4 suggested amounts sum to 14.66" || echo "WARN: S2-4 sum was $TOTAL_SUGG (floating point — not fatal)"

# S2-5: Record settlement Bob→Alice $7.33 and assert balances update
echo "S2-5: POST settlement Bob→Alice \$7.33..."
SET_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X POST "$BASE_URL/api/groups/$GROUP_ID/settlements" \
  -H "Content-Type: application/json" \
  -d "{\"from_member_id\":$BOB_ID,\"to_member_id\":$ALICE_ID,\"amount\":\"7.33\"}")
SET_BODY=$(echo "$SET_RESP" | sed -n '1p')
SET_CODE=$(echo "$SET_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$SET_CODE" = "201" ] && echo "PASS: S2-5 POST settlement returns 201" || { echo "FAIL: S2-5 expected 201 got $SET_CODE"; exit 1; }
SETTLEMENT_ID=$(echo "$SET_BODY" | jq -r '.id')

AFTER_SETTLE=$(curl -s "$BASE_URL/api/groups/$GROUP_ID")
ALICE_SET=$(echo "$AFTER_SETTLE" | jq -r '.members[] | select(.name=="Alice") | .balance')
BOB_SET=$(echo "$AFTER_SETTLE" | jq -r '.members[] | select(.name=="Bob") | .balance')
CAROL_SET=$(echo "$AFTER_SETTLE" | jq -r '.members[] | select(.name=="Carol") | .balance')
# Expected per spec §5.2: Alice=+733c=$7.33, Bob=0, Carol=-733c=-$7.33
echo "$ALICE_SET" | grep -qF "7.33"    && echo "PASS: S2-5 Alice balance is 7.33 after settlement"   || { echo "FAIL: S2-5 Alice expected 7.33 got $ALICE_SET"; exit 1; }
echo "$BOB_SET"   | grep -qF "0.00"   && echo "PASS: S2-5 Bob balance is 0.00 after settlement"     || { echo "FAIL: S2-5 Bob expected 0.00 got $BOB_SET"; exit 1; }
echo "$CAROL_SET" | grep -qF -- "-7.33" && echo "PASS: S2-5 Carol balance is -7.33 after settlement" || { echo "FAIL: S2-5 Carol expected -7.33 got $CAROL_SET"; exit 1; }

# Verify feed contains settlement item
FEED_LEN=$(echo "$AFTER_SETTLE" | jq '.feed | length')
[ "$FEED_LEN" -ge "2" ] && echo "PASS: S2-5 feed has at least 2 items (expense + settlement)" || { echo "FAIL: S2-5 feed length expected >=2 got $FEED_LEN"; exit 1; }
SETTLE_IN_FEED=$(echo "$AFTER_SETTLE" | jq ".feed[] | select(.type==\"settlement\" and .id==$SETTLEMENT_ID) | .id")
[ "$SETTLE_IN_FEED" = "$SETTLEMENT_ID" ] && echo "PASS: S2-5 settlement appears in feed" || { echo "FAIL: S2-5 settlement not found in feed"; exit 1; }

# S2-6: Delete settlement and assert balances revert to pre-settlement state
echo "S2-6: DELETE settlement and assert balances revert..."
DEL_SET_RESP=$(curl -s -w "\nHTTP_CODE:%{http_code}" -X DELETE "$BASE_URL/api/settlements/$SETTLEMENT_ID")
DEL_SET_CODE=$(echo "$DEL_SET_RESP" | grep "HTTP_CODE:" | sed 's/HTTP_CODE://')
[ "$DEL_SET_CODE" = "200" ] && echo "PASS: S2-6 DELETE settlement returns 200" || { echo "FAIL: S2-6 expected 200 got $DEL_SET_CODE"; exit 1; }

AFTER_DEL_SET=$(curl -s "$BASE_URL/api/groups/$GROUP_ID")
ALICE_REV=$(echo "$AFTER_DEL_SET" | jq -r '.members[] | select(.name=="Alice") | .balance')
BOB_REV=$(echo "$AFTER_DEL_SET" | jq -r '.members[] | select(.name=="Bob") | .balance')
CAROL_REV=$(echo "$AFTER_DEL_SET" | jq -r '.members[] | select(.name=="Carol") | .balance')
echo "$ALICE_REV" | grep -qF "14.66"    && echo "PASS: S2-6 Alice balance reverted to 14.66"   || { echo "FAIL: S2-6 Alice expected 14.66 got $ALICE_REV"; exit 1; }
echo "$BOB_REV"   | grep -qF -- "-7.33" && echo "PASS: S2-6 Bob balance reverted to -7.33"     || { echo "FAIL: S2-6 Bob expected -7.33 got $BOB_REV"; exit 1; }
echo "$CAROL_REV" | grep -qF -- "-7.33" && echo "PASS: S2-6 Carol balance reverted to -7.33"   || { echo "FAIL: S2-6 Carol expected -7.33 got $CAROL_REV"; exit 1; }

echo ""
echo "All smoke tests passed (step 1 + step 2)!"
exit 0
```

The existing `echo "All smoke tests passed!" / exit 0` at the bottom of step-1 tests must be replaced with the block above (it becomes the final `exit 0` at the very end).

---

## 7. Ordered Task List (Dependency-Ordered)

1. **Update `src/db.js`** — append settlements DDL + indexes to `db.exec()` string; add PRAGMA guard for split_type column after the `db.exec()` call.

2. **Update `src/balances.js`** — add `computePercentageSplits`; extend `computeBalances` with optional settlements param; add private `balanceStringToCents`; add `simplifyDebts`; export the two new public functions.

3. **Update `src/routes/groups.js` — `POST /api/groups/:id/expenses`** — restructure to read `split_type` and `splits`; implement full validation order per addendum A3 (moving paid_by check to last); branch on split_type; update SQL INSERT to include split_type column; add split_type to 201 response; sort response splits by member_id ASC.

4. **Update `src/routes/groups.js` — `GET /api/groups/:id`** — extend expenses SELECT to include split_type; add split_type to expense objects in both `expenses` array and balance computation; query settlements; pass settlements to `computeBalances`; call `simplifyDebts` for `suggested_settlements`; build `feed` array (merge + sort per spec §6.4); include all new fields in response.

5. **Create `src/routes/settlements.js`** — implement `GET /api/groups/:id/settlements/suggested`, `POST /api/groups/:id/settlements`, `DELETE /api/settlements/:id` with full validation per spec §5.3–5.4.

6. **Update `src/index.js`** — import settlements router; register with `app.use('/api', settlementsRouter)`.

7. **Update `src/routes/pages.js`** — extend `groupPage()`: split-type selector + conditional panels in add-expense form; suggested settlements section; record payment form; activity feed (replaces expense list); updated JS for all interactions.

8. **Update `public/style.css`** — add `.activity-item`, `.settlement-tag`, `.suggested-settlements`, `.settlement-suggestion`, `.record-payment` styles.

9. **Extend `test/smoke.sh`** — replace the final `exit 0` with the step-2 assertion block as specified in §6 above, ending with a combined pass message and `exit 0`.

10. **Run full smoke test suite (`bash test/smoke.sh`) and fix any issues.**

---

## 8. Definition of Done

Step 2's build stage is complete when **all** of the following are true:

- `npm install && npm start` completes without error and the server is reachable on port 3000.
- `bash test/smoke.sh` exits `0` with every assertion printing `PASS`, covering:
  - All original step-1 assertions (group creation, expense creation, balance check, delete, balance revert).
  - S2-1: backward-compat equal-split (no `split_type` field) returns 201 and `split_type: "equal"`.
  - S2-2: exact-split shares match submitted amounts exactly.
  - S2-3: percentage-split 33.33/33.33/33.34 produces 3.33/3.33/3.34 per the deterministic rounding algorithm.
  - S2-4: suggested settlements for a 3-member group with one expense list two transactions that zero all balances.
  - S2-5: recording a settlement returns 201 and the balance formula update is reflected in `GET /api/groups/:id`.
  - S2-6: deleting the settlement returns 200 and balances revert exactly.
- No step-1 functionality has regressed. Confirmed explicitly by the step-1 assertions at the top of `test/smoke.sh` running first — not assumed.
