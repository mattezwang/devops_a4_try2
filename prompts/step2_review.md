You are working in the current git repository. This is stage "review" of
step 2 (extension) of SplitTab. A specification already exists at
`docs/step2-specify.md`, building on the already-implemented step-1 codebase
(`src/`) and step-1 docs. Read `docs/step2-specify.md` in full, and skim the
existing `src/` code (especially `src/balances.js`, `src/routes/groups.js`,
`src/db.js`) to check the new spec is actually compatible with what exists.

Act as a critical spec reviewer, skeptical and thorough, the same role as
the step-1 reviewer. Your ONLY job is to write a review document. Do NOT
write or modify any application code, and do NOT modify
`docs/step2-specify.md` itself.

Create `docs/step2-review.md` with:

1. A short summary and overall verdict (ready to implement / ready with
   fixes / not ready).
2. A numbered list of issues found, each with the section it concerns, what's
   wrong/ambiguous/missing, and a concrete proposed resolution. Look
   especially hard at:
   - Does the extended balance formula (with settlements) actually preserve
     the "sum of all balances = 0" invariant from step 1? Verify with a
     worked numeric example that includes both expenses and a settlement.
   - Is the percentage-to-cents rounding algorithm fully deterministic
     (exact tie-breaking rule stated), and does it correctly handle a
     percentage sum that's within floating-point epsilon of 100.00 but not
     exactly (e.g. `33.33 + 33.33 + 33.34`)?
   - Does the debt-simplification algorithm terminate and produce a correct
     zero-sum result for a non-trivial 4+ member example with mixed
     positive/negative balances? Walk through one by hand.
   - Is `split_type='exact'` validated to reject a `member_id` appearing
     twice in the `splits` array (same class of bug as step 1's
     `split_between` duplicate issue)?
   - Backward compatibility: does every step-1 request (omitting
     `split_type`) still produce byte-identical behavior/response shape to
     before, given the new schema column and response fields?
   - Is deleting a settlement's effect on balances precisely the inverse of
     creating it?
   - Any conflict between the schema migration approach in §2.1 (`ALTER
     TABLE ... ADD COLUMN`, "guard against duplicate column errors") and
     step 1's `CREATE TABLE IF NOT EXISTS` pattern in `src/db.js` — is the
     migration approach concretely specified enough to implement without
     guessing (exact guard logic, e.g. checking `PRAGMA table_info`)?
   If a topic is genuinely solid, say so explicitly rather than inventing an
   issue.
3. A final "Resolved spec addendum" section: for every issue raised, a
   crisp, implementable rule. This addendum plus `docs/step2-specify.md`
   must together leave zero open questions for an implementer.
4. A "Definition of done" checklist for this review stage.

When done writing `docs/step2-review.md`, stop. Do not commit or push. Print
REVIEW_WRITTEN as the last line of your output once the file exists and
looks complete.
