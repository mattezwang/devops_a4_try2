You are working in the current git repository. This is stage "plan" of step
2 (extension) of SplitTab. Three documents are authoritative and must be
read in full:
- `docs/step2-specify.md` (the extension spec)
- `docs/step2-review.md` (review + "Resolved spec addendum" §3, which takes
  precedence on any conflict)
- The existing step-1 codebase in `src/`, `public/`, `test/smoke.sh` — read
  these files too so your plan integrates with what's actually there, not an
  idealized version of it.

Your ONLY job in this stage is to write an implementation plan. Do NOT write
or modify any application code yet.

Create `docs/step2-plan.md` containing:

1. **File-by-file diff plan** — for each existing file that needs changes
   (e.g. `src/db.js`, `src/balances.js`, `src/routes/groups.js`,
   `src/routes/pages.js`, `public/style.css`), a bullet list of what changes
   in it. For each new file to create (e.g. `src/routes/settlements.js` or
   wherever settlement/simplification endpoints live), state its full
   responsibility.
2. **Schema migration plan** — the exact `src/db.js` code changes needed:
   the new `settlements` table + indexes appended to the existing
   `db.exec()` batch, and the `PRAGMA table_info` guarded `ALTER TABLE` for
   `expenses.split_type` exactly as specified in addendum A1 of
   `docs/step2-review.md`.
3. **New/changed pure functions in `src/balances.js`** — signatures and
   responsibilities for: exact-split validation/application, percentage-to-
   cents conversion (per addendum's deterministic sort + remainder rule,
   including the clamp/guard from addendum A4), the extended balance formula
   including settlements, and the debt-simplification (greedy
   largest-creditor/largest-debtor) function. State each as pseudocode
   consistent with the spec+addendum, matching the existing code style in
   the current `src/balances.js` (read it first).
4. **Endpoint-to-file mapping** for every new/changed endpoint: `POST
   /api/groups/:id/expenses` (extended), the debt-simplification GET
   endpoint, `POST` settlement, `DELETE` settlement, and the extended `GET
   /api/groups/:id` response.
5. **HTML page changes** — what changes in the group detail page: split-type
   selector in the add-expense form (equal/exact/percentage with the right
   sub-fields shown/hidden), a "Suggested settlements" section, a
   record-settlement form, and the combined activity feed replacing/
   supplementing the expense list (per addendum decision on §6.1 vs §3.4).
6. **Extended smoke test plan** — exact new assertions to append to
   `test/smoke.sh` (or a new `test/smoke2.sh` that also re-runs the step-1
   assertions — pick one and justify briefly): create a group, add an exact
   split expense and assert its shares, add a percentage split expense and
   assert its shares (use the 33.33/33.33/33.34 case from the review's
   worked example), fetch suggested settlements for a scenario with 3+
   members and assert the transaction list zeroes out balances, record a
   settlement and assert balances update per the extended formula, delete
   the settlement and assert balances revert, and confirm a plain step-1
   style equal-split request (no `split_type` field) still works exactly as
   before.
7. **Ordered task list** for the build stage, dependency-ordered, ending
   with "run full smoke test suite (step 1 + step 2 assertions) and fix
   issues."
8. **Definition of done** for step 2's build stage: `npm install && npm
   start` still works, the full extended smoke test suite exits 0, and no
   step-1 functionality regressed (explicitly re-verified, not assumed).

When done writing `docs/step2-plan.md`, stop. Do not commit, do not push, do
not write any code yet. Print PLAN_WRITTEN as the last line of your output
once the file exists and looks complete.
