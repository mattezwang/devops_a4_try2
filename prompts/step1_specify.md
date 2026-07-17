You are working in the current git repository (a Node.js project directory).
This is stage "specify" of step 1 (base system) of a small web app called
SplitTab: a shared group-expense tracker (like a mini Splitwise).

Your ONLY job in this stage is to write a specification document. Do NOT
write any application code, do NOT run npm install, do NOT create a
package.json. Just write the spec.

Create the file `docs/step1-specify.md` with a clear specification for the
BASE system (later work will extend it, so keep this scoped) covering:

1. Overview / purpose of the app in 2-3 sentences.
2. Tech stack: Node.js + Express backend, SQLite for persistence (e.g. via
   better-sqlite3), server-rendered plain HTML/CSS/vanilla JS frontend (no
   frontend framework, no build step). Single process, `npm start` runs it.
3. Core entities and their fields: Group (id, name), Member (id, group_id,
   name), Expense (id, group_id, description, amount, paid_by member_id,
   created_at), and ExpenseSplit (expense_id, member_id, share_amount) to
   record how an expense is divided among members. For this base step,
   splits are always EQUAL among a chosen subset of the group's members
   (custom/unequal splits are explicitly out of scope for this step).
4. User-facing flows as user stories with acceptance criteria, at minimum:
   - Create a group with a name and an initial list of member names.
   - View a group's page: its members, its expense list, and each member's
     current net balance (positive = owed money, negative = owes money) for
     that group.
   - Add an expense to a group: description, amount, who paid, and which
     members it's split equally between (must include at least 1 member).
   - Delete an expense from a group (balances must update accordingly).
   - List all groups (a simple home page).
5. HTTP API surface (REST-ish JSON endpoints) that the frontend will call,
   with method, path, request body, and response shape for each of the flows
   above.
6. Balance calculation rule, stated precisely: for a group, each member's
   balance = (sum of amounts they paid across the group's expenses) - (sum
   of their share across the group's expenses' splits). Balances across all
   members in a group must always sum to (approximately) zero.
7. Edge cases to explicitly address: rounding when an amount doesn't divide
   evenly among the chosen members (define exactly how remainder cents are
   distributed, e.g. first N members in id order get 1 extra cent), a group
   with zero expenses, deleting an expense that leaves a member with a zero
   balance, and what happens to balance data when there are no members
   selected for a split (this must be rejected as invalid input).
8. Explicit "Out of scope for step 1" list: user authentication/login,
   custom (exact-amount or percentage) splits, settle-up/payment recording,
   debt simplification. These will be built in step 2.
9. A short "Definition of done" checklist for this spec stage.

Write good, concrete, unambiguous prose — a reviewer and then an implementer
will both work only from this document plus the repo, with no other context.

When you are done writing `docs/step1-specify.md`, stop. Do not commit or
push (that will be handled separately). Print the text SPEC_WRITTEN as the
last line of your output once the file exists and looks complete.
