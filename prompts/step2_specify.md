You are working in the current git repository. Step 1 (base system) of
SplitTab is already implemented and committed: an Express + SQLite group
expense tracker with equal-split expenses and raw per-member balances. Read
the existing code (`src/`, `docs/step1-specify.md`, `docs/step1-review.md`,
`docs/step1-plan.md`) to understand exactly what already exists before
writing anything.

This is stage "specify" of step 2, an EXTENSION to the base system. Your
ONLY job in this stage is to write a specification document for the new
features. Do NOT write or modify any application code in this stage.

Create `docs/step2-specify.md` specifying these four new features, building
on (not replacing) the step 1 data model and API:

1. **Custom split types.** When adding an expense, the client may choose a
   split type: `equal` (existing step-1 behavior, unchanged), `exact`
   (caller specifies each selected member's exact cents amount, which must
   sum exactly to the expense total), or `percentage` (caller specifies each
   selected member's percentage as a number, which must sum to exactly
   100.00, converted to cents using the same remainder-distribution rounding
   rule as step 1's equal split, applied in percentage order/member-id order
   — specify precisely). Define the exact new request body shape for
   `POST /api/groups/:id/expenses` (must stay backward compatible: omitting
   `split_type` defaults to `equal` with the existing `split_between` array
   behavior). Define every new validation rule and its error message and
   status code (mismatched sums, negative/zero shares, percentages summing
   to something other than 100.00, unknown split_type value).
2. **Debt simplification.** A read endpoint that, given a group's current
   raw balances, computes a minimal-ish set of settling transactions (who
   pays whom how much) such that after applying them all balances become
   zero, using a greedy algorithm (repeatedly match the largest creditor
   with the largest debtor). State the algorithm precisely enough to be
   deterministic (tie-breaking rule when multiple members have the same
   balance magnitude — use ascending member id). Define the endpoint
   (method, path, response shape) and how it's surfaced on the group HTML
   page (e.g. a "Suggested settlements" section).
3. **Settle-up with history.** A new `Settlement` entity (id, group_id,
   from_member_id, to_member_id, amount cents, created_at) recording that
   one member paid another to reduce what's owed. Define the endpoint to
   record one (method, path, body, validation — both members must belong to
   the group, amount must be positive, a member cannot settle with
   themselves), and how recorded settlements are incorporated into the
   balance calculation (a settlement from A to B reduces A's debt to B: it
   should increase A's balance and decrease B's balance by the settled
   amount, i.e. treated symmetrically with expense-driven balances so the
   group-wide balance sum is still exactly zero after any settlement). Also
   define a delete/undo for a settlement (mirroring expense delete).
4. **Combined activity feed.** Extend the group detail response/page to
   include a single chronological feed merging expenses and settlements
   (each feed item tagged with its type), newest first, replacing or
   supplementing the existing expenses-only list — decide and state which,
   and update the HTML page description accordingly.

For each feature: entity/schema additions, exact HTTP endpoint definitions
(request/response JSON shapes with a worked numeric example), validation
rules with status codes and messages, and interaction with the existing
step-1 balance formula (the new balance formula must be stated precisely,
extending step 1's `balance(member) = total_paid - total_owed` to include
settlements).

Also include:
- An explicit "Out of scope for step 2" list (e.g. still no auth, no editing
  an existing expense's amount/split after creation — delete+recreate only,
  no multi-currency).
- A "Definition of done" checklist for this spec stage.

Write concrete, unambiguous prose with worked numeric examples — a reviewer
and then an implementer will work only from this document (plus the
existing step-1 code and docs), with no other context.

When done writing `docs/step2-specify.md`, stop. Do not commit or push.
Print SPEC_WRITTEN as the last line of your output once the file exists and
looks complete.
