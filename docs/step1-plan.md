# SplitTab — Step 1 Implementation Plan

**Authoritative sources:** `docs/step1-specify.md` + `docs/step1-review.md` §3 addendum (addendum wins on conflicts).

---

## 1. File Layout

```
.gitignore
package.json
src/
  index.js          — Express app entry point; binds to PORT env var (default 3000)
  db.js             — Opens/creates data.db, runs CREATE TABLE IF NOT EXISTS migrations
  balances.js       — Pure functions: dollarsToCents, computeSplits, computeBalances, centsToString
  routes/
    groups.js       — API routes: GET /api/groups, POST /api/groups,
                      GET /api/groups/:id, POST /api/groups/:id/expenses
    expenses.js     — API route: DELETE /api/expenses/:id
    pages.js        — HTML routes: GET /, GET /groups/:id
public/
  style.css         — Minimal stylesheet (layout, balance colors, form spacing)
test/
  smoke.sh          — Bash integration test (see §1 notes below)
```

**Template approach:** Inline JS template literal functions in `src/routes/pages.js`. No templating engine is installed. Rationale: keeps the dependency list minimal (no extra package, no configuration file), avoids a build step, and is sufficient for two simple HTML pages. The functions receive plain data objects and return HTML strings that Express sends via `res.send()`.

**`.gitignore` must include:**
```
node_modules/
*.db
```

### `test/smoke.sh` — detailed spec

The script must:
1. Start the server (`node src/index.js &`) on port 3000 and save its PID.
2. Poll `GET http://localhost:3000/` with `curl -s -o /dev/null -w "%{http_code}"` in a loop (max ~10 attempts, 0.5 s sleep) until it gets 200; exit 1 with an error if the server never comes up.
3. `POST /api/groups` with `{"name":"Smoke","members":["Alice","Bob","Carol"]}` and capture the JSON; extract `group_id` (via `grep`/`sed` or `jq`) and the member IDs for Alice, Bob, Carol.
4. `POST /api/groups/$GROUP_ID/expenses` with `{"description":"Test","amount":"22.00","paid_by":$ALICE_ID,"split_between":[$ALICE_ID,$BOB_ID,$CAROL_ID]}` and assert HTTP 201.
5. `GET /api/groups/$GROUP_ID` and assert:
   - Alice's balance string is `"14.66"` (exact substring match).
   - Bob's balance string is `"-7.33"` (exact substring match).
   - Carol's balance string is `"-7.33"` (exact substring match).
   - (Optional but recommended: parse and verify sum = 0 using `bc` or arithmetic on the integer values.)
6. `DELETE /api/expenses/$EXPENSE_ID` and assert HTTP 200.
7. `GET /api/groups/$GROUP_ID` and assert all three balance strings are `"0.00"`.
8. Kill the server PID, wait for it to exit.
9. `exit 0` on all assertions passing; any failed assertion prints the failing check and calls `exit 1` (after killing the server).

Use `jq` for JSON parsing (preferred, widely available). If not available the script may fall back to `grep -o`.

---

## 2. Database Schema

SQLite dialect. Applied in `src/db.js` using `CREATE TABLE IF NOT EXISTS` so the file can be opened repeatedly without error.

```sql
CREATE TABLE IF NOT EXISTS groups (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES groups(id),
  name     TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES groups(id),
  description TEXT    NOT NULL,
  amount      INTEGER NOT NULL,          -- stored in cents, > 0
  paid_by     INTEGER NOT NULL REFERENCES members(id),
  created_at  TEXT    NOT NULL           -- ISO-8601 UTC, e.g. "2026-07-16T14:00:00.000Z"
);

CREATE TABLE IF NOT EXISTS expense_splits (
  expense_id   INTEGER NOT NULL REFERENCES expenses(id),
  member_id    INTEGER NOT NULL REFERENCES members(id),
  share_amount INTEGER NOT NULL,         -- cents, >= 0
  PRIMARY KEY (expense_id, member_id)
);

-- Indexes for foreign-key traversal (SQLite does not auto-index FK columns)
CREATE INDEX IF NOT EXISTS idx_members_group_id        ON members(group_id);
CREATE INDEX IF NOT EXISTS idx_expenses_group_id       ON expenses(group_id);
CREATE INDEX IF NOT EXISTS idx_splits_expense_id       ON expense_splits(expense_id);
CREATE INDEX IF NOT EXISTS idx_splits_member_id        ON expense_splits(member_id);
```

`PRAGMA foreign_keys = ON` must be enabled on every connection open (better-sqlite3 does not enable it by default).

---

## 3. Dependency List

| Package | Version constraint | Why |
|---|---|---|
| `express` | `^4` | HTTP routing, JSON middleware, static file serving |
| `better-sqlite3` | `^9` | Synchronous SQLite driver; no separate process; fits single-threaded Node |

**Dev dependencies:** none required for step 1 (smoke test uses bash + curl + jq, no Jest/Mocha).

`package.json` scripts:
```json
{
  "scripts": {
    "start": "node src/index.js"
  }
}
```

No transpilation, no build step. Node.js LTS (≥18) is assumed.

---

## 4. Endpoint-to-File Mapping

| Method | Path | File | Handler / function |
|---|---|---|---|
| `GET` | `/api/groups` | `src/routes/groups.js` | `listGroups` |
| `POST` | `/api/groups` | `src/routes/groups.js` | `createGroup` |
| `GET` | `/api/groups/:id` | `src/routes/groups.js` | `getGroup` |
| `POST` | `/api/groups/:id/expenses` | `src/routes/groups.js` | `addExpense` |
| `DELETE` | `/api/expenses/:id` | `src/routes/expenses.js` | `deleteExpense` |
| `GET` | `/` | `src/routes/pages.js` | `homePage` |
| `GET` | `/groups/:id` | `src/routes/pages.js` | `groupPage` |

`src/index.js` mounts these routers:
```js
app.use('/api', groupsRouter);   // from routes/groups.js
app.use('/api', expensesRouter); // from routes/expenses.js
app.use('/', pagesRouter);       // from routes/pages.js
app.use(express.static('public'));
```

All handlers in `groups.js` and `expenses.js` import `db` from `src/db.js` and the pure functions from `src/balances.js`.

---

## 5. Balance / Rounding Implementation Notes

### 5.1 Dollar-to-Cents Conversion (Addendum A6)

```
function dollarsToCents(str):
  // Reject obviously non-numeric input
  if typeof str != "string" OR str matches /[^0-9.]/ OR str is empty:
    throw HTTP 400 "Invalid amount."

  parts = str.split(".")

  if parts.length > 2:
    throw HTTP 400 "Invalid amount."

  intPart = parseInt(parts[0], 10)
  if isNaN(intPart):
    throw HTTP 400 "Invalid amount."

  if parts.length == 1:
    cents = intPart * 100

  else:                              // parts.length == 2
    fracStr = parts[1]
    if fracStr.length == 0 OR fracStr.length > 2:
      throw HTTP 400 "Amount must have at most 2 decimal places."
    fracDigits = parseInt(fracStr, 10)
    if fracStr.length == 1:
      cents = intPart * 100 + fracDigits * 10
    else:                            // fracStr.length == 2
      cents = intPart * 100 + fracDigits

  // Range checks (applied after conversion)
  if cents <= 0:
    throw HTTP 400 "Amount must be a positive number."
  if cents > 99_999_999:
    throw HTTP 400 "Amount exceeds maximum ($999,999.99)."

  return cents   // exact integer, no floating-point arithmetic used
```

### 5.2 Split Computation with Remainder Distribution (Spec §7.1, Addendum A1/A2)

```
function computeSplits(totalCents, memberIds):
  // memberIds: array of member IDs, MUST be sorted ascending before calling
  // Returns array of { memberId, shareCents }

  n         = memberIds.length          // guaranteed >= 1 by prior validation
  baseShare = Math.floor(totalCents / n)
  remainder = totalCents % n            // number of members who get +1 cent

  splits = []
  for i = 0 to n-1:
    shareCents = baseShare + (i < remainder ? 1 : 0)
    splits.push({ memberId: memberIds[i], shareCents })

  // Invariant: SUM(splits[i].shareCents) == totalCents  (always exact)
  return splits
```

### 5.3 Balance Computation (Spec §6, Addendum A2/A7)

```
function computeBalances(members, expenses):
  // members: array of { id, name }
  // expenses: array of { amount (cents), paid_by (member id), splits: [{ member_id, share_amount (cents) }] }
  // Returns: array of { id, name, balance (string, 2 decimal places) }

  paidMap = {}   // member_id -> total cents paid
  owedMap = {}   // member_id -> total cents owed

  for m in members:
    paidMap[m.id] = 0
    owedMap[m.id] = 0

  for expense in expenses:
    paidMap[expense.paid_by] += expense.amount
    for split in expense.splits:
      owedMap[split.member_id] += split.share_amount

  result = []
  for m in members:
    balanceCents = paidMap[m.id] - owedMap[m.id]   // exact integer
    result.push({ id: m.id, name: m.name, balance: centsToString(balanceCents) })

  return result
  // SUM of all balance integers == 0 exactly (guaranteed by computeSplits invariant)
```

### 5.4 Cents-to-String Formatting (Addendum A7)

```
function centsToString(cents):
  // cents: signed integer
  if cents == 0: return "0.00"

  sign    = cents < 0 ? "-" : ""
  abs     = Math.abs(cents)
  dollars = Math.floor(abs / 100)
  pennies = abs % 100

  return sign + String(dollars) + "." + String(pennies).padStart(2, "0")
  // Examples: 1466 -> "14.66", -733 -> "-7.33", 730 -> "7.30"
```

---

## 6. Ordered Task List (Build Stage)

1. **`package.json` + install** — create `package.json` with name, version, `"main": "src/index.js"`, `"start"` script, and `express`/`better-sqlite3` dependencies. Run `npm install`.

2. **`.gitignore`** — add `node_modules/` and `*.db`.

3. **`src/db.js`** — open (or create) `data.db` using `better-sqlite3`; enable `PRAGMA foreign_keys = ON`; run all `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS` statements from §2 above. Export the `db` instance.

4. **`src/balances.js`** — implement `dollarsToCents`, `computeSplits`, `centsToString`, and `computeBalances` as pure/exported functions per §5 above. No Express or DB imports here; these functions are independently testable.

5. **`src/routes/groups.js`** — implement all four group-related API handlers:
   - `GET /api/groups`: `SELECT id, name FROM groups ORDER BY id ASC`.
   - `POST /api/groups`: validate name (trimmed non-empty, max 100), validate members array (≥1 member, each name trimmed non-empty max 100, case-insensitive uniqueness within submission); insert group row, insert member rows in a transaction; return 201 with group + members array ordered by id.
   - `GET /api/groups/:id`: fetch group, members (ORDER BY id ASC), expenses (ORDER BY created_at DESC), splits; call `computeBalances`; return full JSON per §5.3 shape.
   - `POST /api/groups/:id/expenses`: validate group exists; validate description, amount (via `dollarsToCents`), `paid_by` (member of group), `split_between` (non-empty, no duplicates, all members of group); call `computeSplits` on `split_between` sorted by id; insert expense + splits in a transaction; return 201 with expense shape per §5.4.

6. **`src/routes/expenses.js`** — implement `DELETE /api/expenses/:id`: fetch expense (404 if missing); delete `expense_splits` rows then `expenses` row in a transaction; return `{ deleted: true, expense_id }`.

7. **`src/routes/pages.js`** — implement two HTML-generating functions as template literal strings:
   - `homePage(groups)`: renders group list with links and create-group form. Empty-state message when `groups` is empty. The form submits via `fetch()` to `POST /api/groups`, then `window.location` navigates to the new group on success.
   - `groupPage(group)`: renders group name, balance table (with `+$`/`-$`/`$0.00` display format), expense list (most-recent-first, already ordered by API), delete buttons, add-expense form. Each delete button calls `fetch()` with `DELETE /api/expenses/:id`, then reloads. The add-expense form calls `POST /api/groups/:id/expenses`. Empty-state messages for no expenses and all-zero balances.

8. **`public/style.css`** — minimal CSS: body font, centered container, balance color classes (`.positive { color: green }`, `.negative { color: red }`), basic form and table layout.

9. **`src/index.js`** — wire up Express: `express.json()` middleware, `express.static('public')`, mount the three routers, start listening on `process.env.PORT || 3000`. Log the port on startup.

10. **`test/smoke.sh`** — write the bash smoke test per the spec in §1. Mark executable (`chmod +x`).

11. **Smoke test run** — execute `npm install && npm start` (verify no crash), then `bash test/smoke.sh` (or `./test/smoke.sh`). Fix any assertion failures or server errors before declaring the build stage done.

---

## 7. Definition of Done — Step 1 Build Stage

All of the following must be true:

- [ ] `npm install` completes without error.
- [ ] `npm start` starts the server and logs that it is listening on port 3000 (no crash, no unhandled exception at startup).
- [ ] `bash test/smoke.sh` exits with code 0, exercising: group creation, expense creation with uneven split, correct balances (`14.66` / `-7.33` / `-7.33`), expense deletion, zero balances after deletion.
- [ ] All five API endpoints and two HTML routes are reachable and return the correct HTTP status codes (200/201/400/404 as specified).
- [ ] Balance strings in API responses always have exactly 2 decimal places, no `+` prefix, `-` prefix for negatives, and `0.00` (not `-0.00`) for zero.
- [ ] No floating-point arithmetic is used in dollar-to-cents conversion (string-splitting method per A6).
- [ ] `node_modules/` and `*.db` are listed in `.gitignore`.
