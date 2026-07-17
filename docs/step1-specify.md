# SplitTab — Step 1 Base System Specification

## 1. Overview

SplitTab is a shared group-expense tracker that lets a set of people record
expenses, specify who paid and who shares the cost, and instantly see each
person's net balance within the group. It is modeled after tools like
Splitwise but intentionally minimal: no accounts, no logins, no settlement
recording in this base step. The primary use case is a group of friends or
housemates tracking shared costs (e.g. groceries, utilities, travel) and
knowing at a glance who owes whom money.

---

## 2. Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js (LTS) | Single process |
| Web framework | Express | Route handling, JSON middleware |
| Database | SQLite via `better-sqlite3` | File-based, synchronous API, no separate DB process |
| Frontend | Server-rendered HTML + plain CSS + vanilla JS | No framework, no build step, no transpilation |
| Entry point | `npm start` → `node src/index.js` | Binds to `PORT` env var, defaulting to `3000` |

The server renders full HTML pages for each view. Individual interactive
actions (add expense, delete expense) are handled via `fetch()` calls to the
JSON API, with the page refreshing (or updating) inline. There is no
single-page-app routing; each group page is a full server-rendered HTML
document.

---

## 3. Core Entities

### 3.1 Group

Represents a named collection of people sharing expenses.

| Field | Type | Constraints |
|---|---|---|
| `id` | INTEGER | Primary key, auto-increment |
| `name` | TEXT | Not null, non-empty, max 100 chars |

### 3.2 Member

A participant within a specific group.

| Field | Type | Constraints |
|---|---|---|
| `id` | INTEGER | Primary key, auto-increment |
| `group_id` | INTEGER | Foreign key → Group.id, not null |
| `name` | TEXT | Not null, non-empty, max 100 chars |

A member's name must be unique within their group (case-insensitive
comparison). A group must have at least 1 member.

### 3.3 Expense

A single monetary outlay recorded against a group.

| Field | Type | Constraints |
|---|---|---|
| `id` | INTEGER | Primary key, auto-increment |
| `group_id` | INTEGER | Foreign key → Group.id, not null |
| `description` | TEXT | Not null, non-empty, max 200 chars |
| `amount` | INTEGER | Cents (e.g. $12.34 → 1234), not null, > 0 |
| `paid_by` | INTEGER | Foreign key → Member.id, not null; member must belong to this group |
| `created_at` | TEXT | ISO-8601 UTC timestamp, set by server on insert |

Amounts are stored as integer cents throughout the system to avoid
floating-point rounding errors. The API accepts and returns amounts as
decimal dollar strings (e.g. `"12.34"`); conversion to/from cents is
performed in the server layer.

### 3.4 ExpenseSplit

Records how a single expense is divided among members.

| Field | Type | Constraints |
|---|---|---|
| `expense_id` | INTEGER | Foreign key → Expense.id, not null |
| `member_id` | INTEGER | Foreign key → Member.id, not null |
| `share_amount` | INTEGER | Cents, not null, ≥ 0 |

Primary key is `(expense_id, member_id)`. Every row in Expense must have at
least one corresponding ExpenseSplit row. The sum of `share_amount` across all
splits for a given `expense_id` must equal the expense's `amount` (enforced in
application logic on write).

---

## 4. User-Facing Flows (User Stories + Acceptance Criteria)

### 4.1 List All Groups (Home Page)

**Story:** As a user, I want to see all existing groups so I can navigate to
one.

**Acceptance Criteria:**
- `GET /` renders an HTML page listing every group by name.
- Each group name links to its group page (`/groups/:id`).
- If no groups exist, a friendly empty-state message is shown.
- A form on the page allows creating a new group (see §4.2).

---

### 4.2 Create a Group

**Story:** As a user, I want to create a new group with a name and an initial
list of members so the group is ready to use immediately.

**Acceptance Criteria:**
- The user provides a group name and one or more member names (at minimum 1).
- Submitting the form calls `POST /api/groups`.
- On success the user is redirected to (or the page navigates to) the new
  group's page.
- If the group name is blank, the request is rejected with a 400 error and a
  human-readable message.
- If zero member names are provided, the request is rejected with a 400 error.
- Duplicate member names within the submission (case-insensitive) are rejected
  with a 400 error.
- Whitespace-only member names are rejected with a 400 error.

---

### 4.3 View a Group Page

**Story:** As a user, I want to view a group's page showing its members,
expenses, and each member's net balance.

**Acceptance Criteria:**
- `GET /groups/:id` renders an HTML page for the group.
- The page displays the group name.
- The page displays every member's name and their current net balance formatted
  as a dollar amount (e.g. `+$12.34`, `-$5.00`, `$0.00`).
- The page displays a chronological list of expenses (most recent first),
  showing: description, dollar amount, who paid, and which members it was
  split between.
- A form/button on the page allows adding a new expense (see §4.4).
- Each expense has a delete button (see §4.5).
- If the group has no expenses, a friendly empty-state message is shown for
  the expense list; all member balances are `$0.00`.
- If the group `id` does not exist, the server returns 404 with a
  human-readable message.

---

### 4.4 Add an Expense

**Story:** As a user, I want to add an expense to a group by specifying the
description, amount, who paid, and which members share it equally.

**Acceptance Criteria:**
- The user submits description, amount (dollars, up to 2 decimal places), the
  paying member (from the group's member list), and a non-empty subset of the
  group's members to split between (checkboxes).
- Submitting calls `POST /api/groups/:id/expenses`.
- On success, the group page updates to show the new expense and updated
  balances (page refresh is acceptable).
- The paying member does not need to be in the split subset.
- If description is blank, reject with 400.
- If amount is not a positive number (after parsing), reject with 400.
- If `paid_by` is not a valid member of the group, reject with 400.
- If the split member list is empty, reject with 400 with a message: "At least
  one member must be selected for the split."
- If any member in the split list is not a member of the group, reject with
  400.
- Amount is converted to integer cents for storage (see §7 for rounding).

---

### 4.5 Delete an Expense

**Story:** As a user, I want to delete an expense so that balances are
recalculated without it.

**Acceptance Criteria:**
- Clicking the delete button calls `DELETE /api/expenses/:id`.
- On success, the expense and all its ExpenseSplit rows are removed; the
  group page updates to reflect the recalculated balances.
- If the expense `id` does not exist, return 404.
- Deleting an expense that causes a member's balance to become `$0.00` is
  valid and must succeed.
- The group itself and its members are not affected by expense deletion.

---

### 4.6 List All Groups (API)

**Story:** As the frontend, I need to fetch the list of groups.

**Acceptance Criteria:**
- `GET /api/groups` returns JSON array of all groups ordered by `id` ascending.

---

## 5. HTTP API Surface

All API endpoints are prefixed `/api`, accept and return `Content-Type:
application/json`. Amounts in request bodies and responses are decimal dollar
strings (e.g. `"12.34"`), not raw integers.

### 5.1 `GET /api/groups`

List all groups.

**Response 200:**
```json
[
  { "id": 1, "name": "Camping Trip" },
  { "id": 2, "name": "Apartment" }
]
```

---

### 5.2 `POST /api/groups`

Create a new group with initial members.

**Request body:**
```json
{
  "name": "Camping Trip",
  "members": ["Alice", "Bob", "Carol"]
}
```

**Response 201:**
```json
{
  "id": 3,
  "name": "Camping Trip",
  "members": [
    { "id": 7, "name": "Alice" },
    { "id": 8, "name": "Bob" },
    { "id": 9, "name": "Carol" }
  ]
}
```

**Errors:** 400 `{ "error": "<message>" }` for validation failures.

---

### 5.3 `GET /api/groups/:id`

Fetch a group's full data: members, expenses (with splits), and computed
balances.

**Response 200:**
```json
{
  "id": 1,
  "name": "Camping Trip",
  "members": [
    { "id": 7, "name": "Alice", "balance": "14.67" },
    { "id": 8, "name": "Bob",   "balance": "-7.34" },
    { "id": 9, "name": "Carol", "balance": "-7.33" }
  ],
  "expenses": [
    {
      "id": 12,
      "description": "Groceries",
      "amount": "22.00",
      "paid_by": { "id": 7, "name": "Alice" },
      "created_at": "2026-07-16T14:00:00Z",
      "splits": [
        { "member_id": 7, "member_name": "Alice", "share_amount": "7.34" },
        { "member_id": 8, "member_name": "Bob",   "share_amount": "7.33" },
        { "member_id": 9, "member_name": "Carol",  "share_amount": "7.33" }
      ]
    }
  ]
}
```

Balance values are decimal dollar strings; positive means the member is owed
money (net creditor), negative means the member owes money (net debtor).

**Errors:** 404 if group not found.

---

### 5.4 `POST /api/groups/:id/expenses`

Add an expense to a group.

**Request body:**
```json
{
  "description": "Groceries",
  "amount": "22.00",
  "paid_by": 7,
  "split_between": [7, 8, 9]
}
```

- `paid_by`: member `id` (integer)
- `split_between`: array of member `id`s (integers), must be non-empty, all
  must belong to the group

**Response 201:**
```json
{
  "id": 12,
  "description": "Groceries",
  "amount": "22.00",
  "paid_by": { "id": 7, "name": "Alice" },
  "created_at": "2026-07-16T14:00:00Z",
  "splits": [
    { "member_id": 7, "member_name": "Alice", "share_amount": "7.34" },
    { "member_id": 8, "member_name": "Bob",   "share_amount": "7.33" },
    { "member_id": 9, "member_name": "Carol",  "share_amount": "7.33" }
  ]
}
```

**Errors:** 400 for validation failures, 404 if group not found.

---

### 5.5 `DELETE /api/expenses/:id`

Delete an expense and all its splits.

**Response 200:**
```json
{ "deleted": true, "expense_id": 12 }
```

**Errors:** 404 if expense not found.

---

### 5.6 HTML Routes (server-rendered pages)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | Home page — list groups + create-group form |
| `GET` | `/groups/:id` | Group detail page — members, expenses, balances, add/delete forms |

These routes render HTML using inline template strings or a minimal templating
approach. They are not part of the JSON API surface.

---

## 6. Balance Calculation Rule

For a given group, each member's **net balance** is computed as:

```
balance(member) = total_paid(member) - total_owed(member)

where:
  total_paid(member)  = SUM of Expense.amount for all expenses in the group
                        where Expense.paid_by = member.id

  total_owed(member)  = SUM of ExpenseSplit.share_amount for all splits in the
                        group where ExpenseSplit.member_id = member.id
```

**Invariant:** The sum of all members' balances in a group must equal zero
(subject to ±1 cent from rounding, resolved by the rule in §7).

Balances are computed at query time from the raw expense and split data stored
in the database. There is no cached or denormalized balance column.

---

## 7. Edge Cases

### 7.1 Rounding When Amount Doesn't Divide Evenly

When an expense amount (in cents) does not divide evenly among the N selected
members, the remainder is distributed one cent at a time to the first R
members in **ascending `member_id` order**, where R is `amount_cents % N`.

**Example:** $22.00 = 2200 cents ÷ 3 members = 733 cents each with remainder
1. Members sorted by id: [7, 8, 9]. Member 7 gets 734 cents ($7.34); members
8 and 9 get 733 cents ($7.33) each. Sum: 734 + 733 + 733 = 2200. ✓

This rule is deterministic and applied consistently on every write. The
resulting `share_amount` values stored in ExpenseSplit are the authoritative
source; balances are never re-rounded at read time.

### 7.2 Group With Zero Expenses

A group with no expenses is valid. All member balances are `$0.00`. The
expense list on the group page shows an empty-state message.

### 7.3 Deleting an Expense That Leaves a Member With a Zero Balance

This is a normal, valid operation. After deletion, balances are recomputed
from remaining expenses and splits. A resulting `$0.00` balance is displayed
as `$0.00` (not hidden or treated specially).

### 7.4 Empty Split Member List

A `POST /api/groups/:id/expenses` request with `split_between: []` (empty
array) or a missing `split_between` field **must be rejected** with HTTP 400
and the message: `"At least one member must be selected for the split."` No
expense or split rows are written. This prevents orphaned Expense rows with no
associated ExpenseSplit rows.

### 7.5 Dollar-to-Cents Conversion

When accepting an amount such as `"22.00"` or `"22"` from the request body,
the server converts to cents by parsing as a float, multiplying by 100, and
rounding to the nearest integer. Amounts with more than 2 decimal places (e.g.
`"1.234"`) are rejected with HTTP 400: `"Amount must have at most 2 decimal
places."` Amounts ≤ 0 are rejected with HTTP 400: `"Amount must be a positive
number."` Amounts that are not parseable as a number are rejected with HTTP
400: `"Invalid amount."` The maximum accepted amount is $999,999.99 (99999999
cents); larger values are rejected with HTTP 400.

---

## 8. Out of Scope for Step 1

The following features are explicitly **not** part of this step. They will be
addressed in step 2.

- **User authentication / login** — there are no user accounts; groups are
  accessible to anyone with the URL.
- **Custom splits** — expenses are always split equally among the chosen
  subset. Exact-amount splits and percentage-based splits are not supported.
- **Settle-up / payment recording** — there is no way to record that one
  member paid another. Balances reflect only expenses.
- **Debt simplification** — the system shows raw balances per member; it does
  not compute the minimum set of transactions to settle all debts.
- **Adding or removing members after group creation** — the initial member
  list is fixed in step 1.
- **Editing an existing expense** — expenses may only be added or deleted.
- **Pagination** — expense lists and group lists are returned in full with no
  pagination.

---

## 9. Definition of Done

This spec stage is complete when all of the following are true:

- [ ] `docs/step1-specify.md` exists in the repository and contains this
  document.
- [ ] All nine sections above are present and internally consistent (no
  contradictions between entity definitions, API shapes, and balance rules).
- [ ] The rounding rule in §7.1 is unambiguous enough that two independent
  implementers would produce the same `share_amount` values for the same
  input.
- [ ] Every user story in §4 has at least one explicit acceptance criterion
  for the happy path and at least one for a relevant error/edge case.
- [ ] The out-of-scope list in §8 is agreed upon by the team before
  implementation begins.
- [ ] A reviewer has read this document and confirmed that no required
  information for a base implementation is missing.
