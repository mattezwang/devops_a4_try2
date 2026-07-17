You are working in the current git repository, on branch `main`. This is the
"build" stage of step 2 (extension) of SplitTab. The step-1 base system is
already fully implemented and working (`src/`, `public/`, `test/smoke.sh`).
You are running inside an unattended loop: this same prompt will be re-run
against you (a fresh process each time, same repo checkout on disk) until
you print a specific stop token or an iteration limit is reached. Make real,
persistent progress every single iteration, and never break step-1
functionality.

Authoritative documents (read all in full before doing anything):
- `docs/step2-specify.md` — the extension spec
- `docs/step2-review.md` — review + "Resolved spec addendum" §3 (takes
  precedence on any conflict)
- `docs/step2-plan.md` — the implementation plan: file-by-file diff plan,
  schema migration plan, new pure functions, endpoint mapping, HTML changes,
  extended smoke test plan, and an ordered task list (§7)
- The existing code in `src/`, `public/`, `test/smoke.sh` — read it before
  changing it.

Your job: implement the four step-2 features exactly as planned in
`docs/step2-plan.md`, following its ordered task list (§7): custom split
types (exact/percentage) on expense creation, a debt-simplification
endpoint, settle-up with history (create + delete), and the combined
activity feed — without regressing any step-1 behavior.

Process for THIS iteration:
1. Check what already exists on disk (`git status`, `git log --oneline -5`,
   read any files already modified by a previous iteration) — do not redo
   finished work, and do not throw away correct existing work. Pick up where
   the previous iteration left off according to the plan's ordered task
   list.
2. Continue implementing the next incomplete task(s) from `docs/step2-plan.md` §7.
3. Extend `test/smoke.sh` (or add the second smoke script, per whatever the
   plan decided in §6) with the new assertions described in the plan, INCLUDING
   re-running/keeping the original step-1 assertions so a regression is
   caught.
4. Once you believe the implementation is complete per the plan's task list,
   run the full smoke test and fix any failures. Iterate until it exits 0.
5. Before you finish this iteration (regardless of whether the whole task is
   done yet), stage and commit all your changes to git with a clear,
   specific commit message describing what you added/fixed this iteration.
   NEVER leave uncommitted work at the end of an iteration. Do not push
   (that is handled outside this process).
6. Only if, in THIS iteration, `npm install` succeeds, `npm start` boots the
   server without error, and the full smoke test suite (step 1 + step 2
   assertions) exits 0 on a clean run — print the exact literal line
   `STEP2_COMPLETE` as the very last line of your final response, and
   nothing else on that line. Do NOT print it unless you just personally
   verified this in this iteration. If not yet fully working, do not print
   that token — report concise progress instead (what you finished, what's
   left) so the next iteration knows where to continue.

Do not ask the user any questions — you are unattended. Make reasonable
decisions and keep moving. Do not modify `docs/step2-specify.md`,
`docs/step2-review.md`, or `docs/step2-plan.md`, or any of the step-1 docs.
