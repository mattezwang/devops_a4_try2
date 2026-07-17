# SplitTab — Step 2 Specification

**Builds on:** `docs/step1-specify.md` + `docs/step1-review.md` (addendum is authoritative on conflicts)
**Scope:** Four extensions to the base system. All step-1 entities, endpoints, and behaviors remain unchanged unless explicitly noted.

---

## 1. Overview

Step 2 extends SplitTab with four features:

1. **Custom split types** — expenses may be split equally (existing), by exact per-member cent amounts, or by percentage.
2. **Debt simplification** — a read-only endpoint computes a minimal-ish set of who-pays-whom transactions to zero out all balances.
3. **Settle-up with history** — members can record cash payments to each other; those payments are reflected in balances.
4. **Combined activity feed** — the group page shows expenses and settlements in one chronological list.

No step-1 behavior is changed. Every new feature is additive: new DB columns/tables, new endpoints, and extensions to existing endpoint responses.

---

## 2. Schema Additions

### 2.1 New column on `expenses`: `split_type`

Add one column to the existing `expenses` table:

```sql
ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal';
```

`split_type` stores the split method used when the expense was created. Valid values: `'equal'`, `'exact'`, `'percentage'`. All existing rows receive the default `'equal'` via the `DEFAULT` clause.

Because `better-sqlite3` runs `CREATE TABLE IF NOT EXISTS` migrations on startup, add this column migration to `src/db.js` using an idempotent pattern:

```sql
-- Run after the CREATE TABLE statements already present from step 1
ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal';
```

In practice, guard against "duplicate column" errors by catching the SQLite error if the column already exists (or check `PRAGMA table_info(expenses)` first). The column must be present for all expense inserts in step 2.

### 2.2 New table: `settlements`

```sql
CREATE TABLE IF NOT EXISTS settlements (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id       INTEGER NOT NULL REFERENCES groups(id),
  from_member_id INTEGER NOT NULL REFERENCES members(id),
  to_member_id   INTEGER NOT NULL REFERENCES members(id),
  amount         INTEGER NOT NULL,   -- cents, > 0
  created_at     TEXT    NOT NULL    -- ISO-8601 UTC
);
```

A `Settlement` row records that `from_member_id` paid `to_member_id` the given `amount` in cents, within `group_id`, at `created_at`.

Both `from_member_id` and `to_member_id` must be members of `group_id` (enforced in application logic; SQLite FKs only guarantee they exist in the `members` table globally).

### 2.3 New indexes for `settlements`

```sql
CREATE INDEX IF NOT EXISTS idx_settlements_group_id      ON settlements(group_id);
CREATE INDEX IF NOT EXISTS idx_settlements_from_member   ON settlements(from_member_id);
CREATE INDEX IF NOT EXISTS idx_settlements_to_member     ON settlements(to_member_id);
```

---

## 3. Feature 1: Custom Split Types

### 3.1 Summary

`POST /api/groups/:id/expenses` gains an optional `split_type` field. Omitting `split_type` continues to behave exactly as in step 1 (`equal` split using `split_between`). Providing `split_type: "equal"` is equivalent to omitting it. Providing `"exact"` or `"percentage"` changes which additional fields are required.

### 3.2 Request Body Shapes

#### 3.2.1 `equal` (backward-compatible, unchanged)

```json
{
  "description": "Groceries",
  "amount": "22.00",
  "paid_by": 7,
  "split_between": [7, 8, 9]
}
```

With the explicit field (equivalent):

```json
{
  "description": "Groceries",
  "amount": "22.00",
  "paid_by": 7,
  "split_type": "equal",
  "split_between": [7, 8, 9]
}
```

Behavior is identical to step 1. The `split_type` field `"equal"` is stored in the `expenses.split_type` column. When `split_type` is absent the value `"equal"` is stored.

#### 3.2.2 `exact`

The caller specifies each split member's exact share as a dollar string. Shares must sum to the expense total.

```json
{
  "description": "Dinner",
  "amount": "30.00",
  "paid_by": 7,
  "split_type": "exact",
  "splits": [
    { "member_id": 7, "amount": "10.00" },
    { "member_id": 8, "amount": "20.00" }
  ]
}
```

- `splits`: non-empty array; each element has:
  - `member_id`: integer, must belong to the group
  - `amount`: dollar string, validated the same way as the expense `amount` (via `dollarsToCents`); must be ≥ 1 cent (positive)
- No `split_between` field is used for `exact` splits; if present it is ignored.
- The sum of `dollarsToCents(item.amount)` across all `splits` items must equal `dollarsToCents(amount)` exactly.
- No duplicate `member_id` values are permitted in the `splits` array.

#### 3.2.3 `percentage`

The caller specifies each split member's share as a percentage (a positive JSON number). Percentages must sum to exactly 100.00. The server converts percentages to cent amounts using the rounding algorithm in §3.3.

```json
{
  "description": "Rent",
  "amount": "100.00",
  "paid_by": 7,
  "split_type": "percentage",
  "splits": [
    { "member_id": 7, "percentage": 40.00 },
    { "member_id": 8, "percentage": 33.33 },
    { "member_id": 9, "percentage": 26.67 }
  ]
}
```

- `splits`: non-empty array; each element has:
  - `member_id`: integer, must belong to the group
  - `percentage`: positive number (JSON number type, not a string); must be > 0
- No `split_between` field is used for `percentage` splits; if present it is ignored.
- Sum validation: let `S = sum of all percentage values`. The sum is accepted as valid if and only if `Math.round(S * 100) === 10000`. This criterion handles minor IEEE 754 floating-point accumulation without permitting sums that are clearly not 100. Any other sum → 400 error (see §3.5).
- No duplicate `member_id` values are permitted.

### 3.3 Percentage-to-Cents Rounding Algorithm

This algorithm converts percentage shares to integer cent amounts such that their sum equals `totalCents` exactly, using the same remainder-distribution style as step 1's equal-split.

```
Input:
  totalCents  — integer, the expense amount in cents
  splits      — array of { memberId, percentage }, with SUM(percentage) ≈ 100.00

Step 1 — Sort splits for remainder distribution:
  sortedSplits = splits sorted by:
    primary:   percentage DESCENDING (largest percentage first)
    secondary: memberId ASCENDING (ties broken by lower member id first)

Step 2 — Compute floor amounts:
  for each s in sortedSplits:
    s.floorCents = Math.floor(totalCents * s.percentage / 100)

Step 3 — Compute remainder:
  totalFloor = SUM(s.floorCents for s in sortedSplits)
  remainder  = totalCents - totalFloor     // integer, 0 ≤ remainder < len(sortedSplits)

Step 4 — Distribute remainder (+1 cent each to the first `remainder` entries):
  for i = 0 to len(sortedSplits) - 1:
    if i < remainder:
      sortedSplits[i].shareCents = sortedSplits[i].floorCents + 1
    else:
      sortedSplits[i].shareCents = sortedSplits[i].floorCents

Invariant: SUM(shareCents) == totalCents  (always exact)
```

**Why this is exact:** `Math.floor(totalCents * p / 100)` may under-count by at most 0.9999…, so the total floor sum undershoots `totalCents` by at most `len(splits) - 1` cents. The sum of all `(totalCents * p / 100)` values (before flooring) equals `totalCents * SUM(p) / 100 ≈ totalCents` (due to the 100.00 sum validation). In practice, with percentages summing to 100.00, `remainder` is always ≥ 0 and < `len(splits)`. The one-cent-per-member distribution in sorted order is deterministic.

**Worked example:** Expense $10.00 = 1000 cents; members 7 (40.00%), 8 (33.33%), 9 (26.67%).

Sort by percentage DESC, memberId ASC:
1. Member 7: 40.00%
2. Member 8: 33.33%
3. Member 9: 26.67%

Floor amounts:
- Member 7: `floor(1000 × 40.00 / 100)` = `floor(400.00)` = 400 cents
- Member 8: `floor(1000 × 33.33 / 100)` = `floor(333.3)` = 333 cents
- Member 9: `floor(1000 × 26.67 / 100)` = `floor(266.7)` = 266 cents

Total floor = 400 + 333 + 266 = 999. Remainder = 1000 − 999 = **1**.

Distribute: Member 7 (first in order) gets +1 cent.

Final shares: Member 7 → 401 cents ($4.01), Member 8 → 333 cents ($3.33), Member 9 → 266 cents ($2.66). Sum = 1000 ✓.

**Tie-breaking example:** Expense $10.01 = 1001 cents; member 7 (50%), member 8 (50%).

Sort: both 50%, tie broken by memberId ASC → [member 7, member 8].
Floor: each gets `floor(1001 × 50 / 100)` = `floor(500.5)` = 500 cents.
Total floor = 1000. Remainder = 1.
Member 7 (position 0 < 1) gets +1 cent → 501 cents ($5.01). Member 8 → 500 cents ($5.00). Sum = 1001 ✓.

### 3.4 Response Shape

The `201` response for all split types has the same shape as step 1, extended with `split_type`:

```json
{
  "id": 13,
  "description": "Rent",
  "amount": "100.00",
  "split_type": "percentage",
  "paid_by": { "id": 7, "name": "Alice" },
  "created_at": "2026-07-16T15:00:00.000Z",
  "splits": [
    { "member_id": 7, "member_name": "Alice", "share_amount": "4.01" },
    { "member_id": 8, "member_name": "Bob",   "share_amount": "3.33" },
    { "member_id": 9, "member_name": "Carol",  "share_amount": "2.66" }
  ]
}
```

`split_type` is also included in each expense object within `GET /api/groups/:id` `expenses` and `feed` arrays.

The `splits` array in the response is always ordered by `member_id` ascending, regardless of split type. This is consistent with step 1.

### 3.5 Validation Rules

All step-1 validations for `description`, `amount`, `paid_by`, and (for `equal`) `split_between` remain in effect. New validations:

| Condition | HTTP Status | Error message |
|---|---|---|
| `split_type` is present and not one of `"equal"`, `"exact"`, `"percentage"` | 400 | `"Invalid split_type. Must be one of: equal, exact, percentage."` |
| `split_type` is `"exact"` or `"percentage"` and `splits` is absent, not an array, or empty | 400 | `"At least one member must be selected for the split."` |
| `split_type` is `"exact"` or `"percentage"` and `splits` contains a duplicate `member_id` | 400 | `"splits contains duplicate member IDs."` |
| `split_type` is `"exact"` or `"percentage"` and any `member_id` in `splits` does not belong to the group | 400 | `"All split members must belong to this group."` |
| `split_type` is `"exact"` and any `splits[i].amount` is not a valid dollar string (per `dollarsToCents` rules) | 400 | (re-use the exact message from `dollarsToCents`, e.g. `"Invalid amount."`, `"Amount must be a positive number."`) |
| `split_type` is `"exact"` and any `splits[i].amount` converts to 0 cents or is negative | 400 | `"Each exact split amount must be a positive number."` |
| `split_type` is `"exact"` and the cent sum of all `splits[i].amount` ≠ expense amount in cents | 400 | `"Exact split amounts must sum to the expense total."` |
| `split_type` is `"percentage"` and any `splits[i].percentage` is not a positive number (≤ 0, NaN, non-number) | 400 | `"Each percentage must be a positive number."` |
| `split_type` is `"percentage"` and `Math.round(SUM(percentages) * 100) !== 10000` | 400 | `"Percentage splits must sum to exactly 100.00."` |

Validation order: `split_type` value → `splits` array presence/emptiness → duplicate `member_id` checks → individual `member_id` membership → individual amount/percentage validity → sum check. All validations are completed before any DB write.

---

## 4. Feature 2: Debt Simplification

### 4.1 Algorithm

Given a group's current member balances (as computed by the full balance formula in §5.2), the greedy debt-simplification algorithm produces a minimal-ish list of "who pays whom how much" transactions that would zero all balances.

**Inputs:** An array of `{ memberId, memberName, balanceCents }` for every member of the group, where `balanceCents` is the signed integer balance (positive = net creditor, negative = net debtor, zero = settled). The sum of all `balanceCents` is exactly zero (guaranteed by the balance formula invariant).

```
Algorithm:

1. Initialize two lists from the input:
     creditors = [{ memberId, memberName, balanceCents }] for all members where balanceCents > 0
     debtors   = [{ memberId, memberName, balanceCents }] for all members where balanceCents < 0

2. While creditors is non-empty AND debtors is non-empty:

   a. Pick the largest creditor C:
        C = creditor with the highest balanceCents;
        tie-break: lowest memberId ascending.

   b. Pick the largest debtor D:
        D = debtor with the most negative balanceCents (i.e. lowest value);
        tie-break: lowest memberId ascending.

   c. Compute settlement amount:
        amount = min(C.balanceCents, -D.balanceCents)   // always > 0

   d. Record the transaction:
        { from: D, to: C, amount }   // D pays C

   e. Update balances:
        C.balanceCents -= amount
        D.balanceCents += amount   // moves D toward zero

   f. If C.balanceCents == 0: remove C from creditors.
      If D.balanceCents == 0: remove D from debtors.

3. Return the list of recorded transactions.
   (All creditor and debtor balances are now zero.)
```

**Determinism guarantee:** At each iteration, picking the unique largest creditor and unique largest debtor is deterministic. Ties in balance magnitude are broken by lowest `memberId` ascending. Since each iteration reduces at least one member's balance to exactly zero and removes them from their list, the algorithm terminates in at most `(number of members − 1)` steps.

**Note:** "Minimal-ish" means the greedy approach minimizes the number of transactions in the common case (no cyclic debts) but does not guarantee the global minimum for all possible balance configurations. This is acceptable for this application.

### 4.2 Endpoint Definition

**`GET /api/groups/:id/settlements/suggested`**

Computes and returns the greedy suggested settlements for the group. This is a pure read endpoint — it does not write any rows.

**Response 200:**

```json
{
  "suggested_settlements": [
    {
      "from": { "id": 8, "name": "Bob" },
      "to":   { "id": 7, "name": "Alice" },
      "amount": "7.33"
    },
    {
      "from": { "id": 9, "name": "Carol" },
      "to":   { "id": 7, "name": "Alice" },
      "amount": "7.33"
    }
  ]
}
```

`amount` is a dollar string (2 decimal places, no sign prefix, always positive), using the same `centsToString` formatter as step 1.

When all balances are zero, `suggested_settlements` is an empty array `[]`.

**Errors:** 404 if group not found.

**Worked numeric example:** Group has three members after one $22.00 grocery expense paid by Alice, split equally among Alice (id 7), Bob (id 8), and Carol (id 9). Balances (from step 1 rounding example): Alice +1466 cents, Bob −733 cents, Carol −733 cents.

Algorithm execution:
- creditors: [{ id:7, 1466 }]
- debtors:   [{ id:8, −733 }, { id:9, −733 }]

Iteration 1:
- Largest creditor: Alice (1466)
- Largest debtor by magnitude: Bob and Carol both −733 — tie broken by memberId → Bob (id 8)
- amount = min(1466, 733) = 733
- Transaction: Bob pays Alice $7.33
- Alice: 1466 − 733 = 733; Bob: −733 + 733 = 0 → remove Bob

Iteration 2:
- creditors: [{ id:7, 733 }]; debtors: [{ id:9, −733 }]
- Largest creditor: Alice (733)
- Largest debtor: Carol (−733)
- amount = min(733, 733) = 733
- Transaction: Carol pays Alice $7.33
- Alice: 733 − 733 = 0 → remove Alice; Carol: 0 → remove Carol

Result:
```json
{
  "suggested_settlements": [
    { "from": { "id": 8, "name": "Bob"   }, "to": { "id": 7, "name": "Alice" }, "amount": "7.33" },
    { "from": { "id": 9, "name": "Carol" }, "to": { "id": 7, "name": "Alice" }, "amount": "7.33" }
  ]
}
```

### 4.3 Inclusion in `GET /api/groups/:id`

The `GET /api/groups/:id` response is extended with a `suggested_settlements` field computed using the same algorithm:

```json
{
  "id": 1,
  "name": "Camping Trip",
  "members": [...],
  "suggested_settlements": [
    { "from": { "id": 8, "name": "Bob" }, "to": { "id": 7, "name": "Alice" }, "amount": "7.33" },
    { "from": { "id": 9, "name": "Carol" }, "to": { "id": 7, "name": "Alice" }, "amount": "7.33" }
  ],
  "expenses": [...],
  "feed": [...]
}
```

The `suggested_settlements` field is always present (empty array when all balances are zero).

### 4.4 HTML Page Surfacing

The server-rendered `GET /groups/:id` page gains a **"Suggested Settlements"** section rendered between the Balances table and the Expenses/Activity Feed. The section is computed server-side during the page render (same logic as the API endpoint) and is not a separate client-side fetch.

When all balances are zero, the section displays: *"All balances are settled — no payments needed."*

When settlements are suggested, each item is displayed as a line such as:
> Bob pays Alice **$7.33**

Each suggested settlement line also renders a **"Record this payment"** button. Clicking it submits a `POST /api/groups/:id/settlements` request pre-filled with `from_member_id`, `to_member_id`, and `amount` from that suggestion (see §5.3), then reloads the page.

---

## 5. Feature 3: Settle-up with History

### 5.1 Settlement Entity

As defined in §2.2. Summary:

| Field | Type | Constraints |
|---|---|---|
| `id` | INTEGER | Primary key, auto-increment |
| `group_id` | INTEGER | FK → `groups.id`, not null |
| `from_member_id` | INTEGER | FK → `members.id`, not null; must belong to `group_id` |
| `to_member_id` | INTEGER | FK → `members.id`, not null; must belong to `group_id` |
| `amount` | INTEGER | Cents, not null, > 0 |
| `created_at` | TEXT | ISO-8601 UTC, set by server on insert |

### 5.2 Extended Balance Formula

Settlements are incorporated into balances symmetrically with expense-driven balances. The updated formula:

```
balance(member) = total_paid(member)
                − total_owed(member)
                + settled_out(member)
                − settled_in(member)

where:
  total_paid(member)    = SUM of Expense.amount
                          for all expenses in the group where Expense.paid_by = member.id

  total_owed(member)    = SUM of ExpenseSplit.share_amount
                          for all splits in the group where ExpenseSplit.member_id = member.id

  settled_out(member)   = SUM of Settlement.amount
                          for all settlements in the group where Settlement.from_member_id = member.id

  settled_in(member)    = SUM of Settlement.amount
                          for all settlements in the group where Settlement.to_member_id = member.id
```

**Interpretation:** A settlement from member A to member B (A paid B) increases A's balance (A has reduced their net debt) and decreases B's balance (B has received money, reducing what the group owes them).

**Zero-sum invariant:** `SUM of all balances in a group = 0` always holds. Proof: the expense terms sum to zero (as guaranteed by step 1's split invariant). The settlement terms also sum to zero because every `Settlement.amount` appears once in some member's `settled_out` and once in another's `settled_in`, so their net contribution to the group sum is zero.

**Worked numeric example (continuing §4.2 example):** After Bob records a settlement paying Alice $7.33 (733 cents):

- Alice: `total_paid=2200, total_owed=734, settled_out=0, settled_in=733`
  Balance = 2200 − 734 + 0 − 733 = **733 cents = $7.33**
- Bob: `total_paid=0, total_owed=733, settled_out=733, settled_in=0`
  Balance = 0 − 733 + 733 − 0 = **0 cents = $0.00**
- Carol: `total_paid=0, total_owed=733, settled_out=0, settled_in=0`
  Balance = 0 − 733 + 0 − 0 = **−733 cents = −$7.33**

Group sum: 733 + 0 + (−733) = 0 ✓.

After Carol also pays Alice $7.33:
- Alice: 2200 − 734 + 0 − 1466 = **0.00**
- Bob: **$0.00** (unchanged)
- Carol: 0 − 733 + 733 − 0 = **$0.00**
- Group sum: 0 ✓.

### 5.3 Create a Settlement

**`POST /api/groups/:id/settlements`**

**Request body:**

```json
{
  "from_member_id": 8,
  "to_member_id":   7,
  "amount":         "7.33"
}
```

- `from_member_id`: integer, must be a member of the group
- `to_member_id`: integer, must be a member of the group; must not equal `from_member_id`
- `amount`: dollar string; validated via `dollarsToCents` (same rules as expense amount: positive, ≤ $999,999.99, ≤ 2 decimal places)

**Response 201:**

```json
{
  "id": 1,
  "group_id": 1,
  "from_member_id":   8,
  "from_member_name": "Bob",
  "to_member_id":     7,
  "to_member_name":   "Alice",
  "amount":           "7.33",
  "created_at":       "2026-07-16T15:00:00.000Z"
}
```

**Validation rules:**

| Condition | HTTP Status | Error message |
|---|---|---|
| Group not found | 404 | `"Group not found."` |
| `from_member_id` is not a member of the group | 400 | `"from_member_id must be a member of this group."` |
| `to_member_id` is not a member of the group | 400 | `"to_member_id must be a member of this group."` |
| `from_member_id === to_member_id` | 400 | `"A member cannot settle with themselves."` |
| `amount` fails any `dollarsToCents` validation | 400 | (message from `dollarsToCents`, e.g. `"Amount must be a positive number."`) |

Validation order: group existence → `from_member_id` membership → `to_member_id` membership → self-settlement check → amount validation. No DB write occurs before all validations pass.

### 5.4 Delete a Settlement

**`DELETE /api/settlements/:id`**

Deletes a previously recorded settlement and removes its effect from balances (since balances are computed at query time from the raw data, deletion is sufficient).

**Response 200:**

```json
{ "deleted": true, "settlement_id": 1 }
```

**Errors:** 404 `{ "error": "Settlement not found." }` if the settlement id does not exist.

This mirrors `DELETE /api/expenses/:id` from step 1.

### 5.5 HTML Page Changes

The group page gains:

1. **A "Record a Payment" form** below the Suggested Settlements section (or below the Balances table if no settlements are suggested). The form lets a user select who paid, who received, and the dollar amount, then submits to `POST /api/groups/:id/settlements` via `fetch()`, reloading the page on success.

2. **Settlement delete buttons** in the activity feed (see §6), mirroring the expense delete buttons. Each settlement item in the feed has a delete button that calls `DELETE /api/settlements/:id` and reloads on success.

---

## 6. Feature 4: Combined Activity Feed

### 6.1 Decision: Supplement, Not Replace

The existing `expenses` array in `GET /api/groups/:id` is **retained unchanged** for backward compatibility. A new `feed` array is added alongside it. The HTML group page renders the `feed` instead of `expenses`. This allows API clients that already consume `expenses` to continue working without changes.

### 6.2 Feed Item Shapes

Each feed item has a `type` field identifying whether it is an expense or a settlement.

**Expense feed item:**

```json
{
  "type":        "expense",
  "id":          12,
  "created_at":  "2026-07-16T14:00:00.000Z",
  "description": "Groceries",
  "amount":      "22.00",
  "split_type":  "equal",
  "paid_by":     { "id": 7, "name": "Alice" },
  "splits": [
    { "member_id": 7, "member_name": "Alice", "share_amount": "7.34" },
    { "member_id": 8, "member_name": "Bob",   "share_amount": "7.33" },
    { "member_id": 9, "member_name": "Carol",  "share_amount": "7.33" }
  ]
}
```

This is the same shape as an entry in the `expenses` array, with `"type": "expense"` prepended.

**Settlement feed item:**

```json
{
  "type":             "settlement",
  "id":               1,
  "created_at":       "2026-07-16T15:00:00.000Z",
  "from_member":      { "id": 8, "name": "Bob" },
  "to_member":        { "id": 7, "name": "Alice" },
  "amount":           "7.33"
}
```

### 6.3 Extension of `GET /api/groups/:id` Response

The full response shape:

```json
{
  "id": 1,
  "name": "Camping Trip",
  "members": [
    { "id": 7, "name": "Alice", "balance": "0.00" },
    { "id": 8, "name": "Bob",   "balance": "0.00" },
    { "id": 9, "name": "Carol",  "balance": "0.00" }
  ],
  "suggested_settlements": [],
  "expenses": [
    {
      "id": 12,
      "description": "Groceries",
      "amount": "22.00",
      "split_type": "equal",
      "paid_by": { "id": 7, "name": "Alice" },
      "created_at": "2026-07-16T14:00:00.000Z",
      "splits": [
        { "member_id": 7, "member_name": "Alice", "share_amount": "7.34" },
        { "member_id": 8, "member_name": "Bob",   "share_amount": "7.33" },
        { "member_id": 9, "member_name": "Carol",  "share_amount": "7.33" }
      ]
    }
  ],
  "feed": [
    {
      "type": "settlement",
      "id": 2,
      "created_at": "2026-07-16T16:00:00.000Z",
      "from_member": { "id": 9, "name": "Carol" },
      "to_member":   { "id": 7, "name": "Alice" },
      "amount": "7.33"
    },
    {
      "type": "settlement",
      "id": 1,
      "created_at": "2026-07-16T15:00:00.000Z",
      "from_member": { "id": 8, "name": "Bob" },
      "to_member":   { "id": 7, "name": "Alice" },
      "amount": "7.33"
    },
    {
      "type": "expense",
      "id": 12,
      "created_at": "2026-07-16T14:00:00.000Z",
      "description": "Groceries",
      "amount": "22.00",
      "split_type": "equal",
      "paid_by": { "id": 7, "name": "Alice" },
      "splits": [
        { "member_id": 7, "member_name": "Alice", "share_amount": "7.34" },
        { "member_id": 8, "member_name": "Bob",   "share_amount": "7.33" },
        { "member_id": 9, "member_name": "Carol",  "share_amount": "7.33" }
      ]
    }
  ]
}
```

### 6.4 Feed Ordering Rules

The `feed` array is sorted as follows:

1. **Primary:** `created_at` descending (newest first; ISO-8601 strings sort correctly lexicographically).
2. **Secondary (same `created_at`):** `type` ascending alphabetically — `"expense"` sorts before `"settlement"`. Rationale: in practice an expense is created first, then later settled.
3. **Tertiary (same `created_at` and same `type`):** `id` descending (higher id = more recently inserted row).

The `expenses` array (retained for backward compat) continues to be ordered by `created_at` descending as per step 1.

### 6.5 HTML Page Changes

The group page replaces the old **"Expenses"** section with an **"Activity"** section that renders the `feed` array. Each feed item is rendered as follows:

- **Expense item:** Same as step 1's expense display — description, amount, paid by, split between. Includes a **Delete** button that calls `DELETE /api/expenses/:id`.
- **Settlement item:** Displayed as: *"Bob paid Alice $7.33"* with a label tag (e.g. `[settlement]`). Includes a **Delete** button that calls `DELETE /api/settlements/:id`.

If the `feed` is empty, an empty-state message is shown: *"No activity yet."*

---

## 7. Out of Scope for Step 2

The following are explicitly **not** part of step 2:

- **User authentication / login.** Groups remain accessible to anyone with the URL.
- **Editing an existing expense.** Expenses may only be added or deleted. To correct an expense, delete it and re-add it.
- **Editing an existing settlement.** Settlements may only be recorded or deleted (undone).
- **Adding or removing members after group creation.** The member list is fixed when the group is created (unchanged from step 1).
- **Multi-currency.** All amounts are in a single unnamed currency; no conversion or currency codes.
- **Partial settlements / partial expense updates.** A settlement records a payment in full as entered; there is no "mark as partially settled" concept.
- **Pagination.** All expense, settlement, and feed lists are returned in full with no pagination.
- **Settlement between members of different groups.** A settlement must reference two members that both belong to the same group as identified by the URL's `:id`.
- **Negative or zero settlements.** The `amount` for a settlement must be a positive dollar value (≥ 1 cent).
- **Bulk settlement recording.** The `POST /api/groups/:id/settlements` endpoint records exactly one settlement per request.
- **"Apply all suggestions" action.** The suggested settlements section shows individual "Record this payment" buttons only; there is no "settle everything at once" button.

---

## 8. Definition of Done

This spec stage is complete when all of the following are true:

- [ ] `docs/step2-specify.md` exists in the repository and contains this document.
- [ ] **Feature 1 (Custom splits):** The new `POST /api/groups/:id/expenses` request body shapes for all three `split_type` values are fully defined, with backward-compatible default behavior. The percentage rounding algorithm is stated precisely enough for two independent implementers to produce bit-identical `share_amount` values for any input. Every validation rule has an exact error message and HTTP status code.
- [ ] **Feature 2 (Debt simplification):** The greedy algorithm is stated step-by-step with explicit tie-breaking rules. The endpoint method, path, and response JSON shape are defined. A worked numeric example is provided that can be traced by hand. The HTML page surfacing decision (server-rendered section) is described.
- [ ] **Feature 3 (Settle-up):** The `settlements` table schema is fully defined. The extended balance formula is written out explicitly, showing how `settled_out` and `settled_in` terms integrate with the step-1 formula. All validation rules for `POST /api/groups/:id/settlements` have exact messages and status codes. Delete behavior (and its effect on balances) is described. A worked numeric example demonstrates the balance change after one settlement.
- [ ] **Feature 4 (Activity feed):** The decision to supplement (not replace) the `expenses` field is stated and justified. Both feed item shapes are defined. The sort-ordering rules (including tie-breaking) are unambiguous. HTML rendering for both item types is described.
- [ ] **Zero-sum invariant:** The document proves (or demonstrates via worked example) that the extended balance formula preserves the group-wide zero-sum invariant for both new expenses (all split types) and settlements.
- [ ] **Schema additions:** Both the `expenses.split_type` column addition and the `settlements` table DDL are fully specified, including migration strategy for the existing `expenses` table.
- [ ] **Out-of-scope list** is agreed upon before implementation begins.
- [ ] A reviewer has read this document and confirmed that no required information for the step-2 implementation is missing.
- [ ] No application code has been written or modified as part of this spec stage.
