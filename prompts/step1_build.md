You are working in the current git repository, on branch `main`. This is the
"build" stage of step 1 (base system) of SplitTab, a shared group-expense
tracker. You are running inside an unattended loop: this same prompt will be
re-run against you (a fresh process each time, same repo checkout on disk)
until you print a specific stop token or an iteration limit is reached. Make
real, persistent progress every single iteration.

Authoritative documents (read all three in full before doing anything):
- `docs/step1-specify.md` — the spec
- `docs/step1-review.md` — review + "Resolved spec addendum" (§3), which
  takes precedence over the original spec on any conflict
- `docs/step1-plan.md` — the implementation plan: exact file layout, DB
  schema, dependency list, endpoint-to-file mapping, balance/rounding
  pseudocode, an ordered task list, and a definition of done

Your job: implement the entire base system exactly as planned in
`docs/step1-plan.md`, section by section, following its ordered task list
(§6). Do not deviate from the plan's file layout, schema, or algorithms
unless you discover the plan is genuinely broken — if so, fix it minimally
and note the deviation in a code comment.

Process for THIS iteration:
1. Check what already exists on disk (`git status`, `ls`, read any files
   already created by a previous iteration) — do not redo finished work, and
   do not throw away correct existing work. Pick up where the previous
   iteration left off according to the plan's ordered task list.
2. Continue implementing the next incomplete task(s) from the plan.
3. As soon as `package.json` exists, you can run `npm install`. As soon as
   `src/index.js` exists, you can smoke-test manually with `npm start &` and
   `curl`.
4. Once you believe the implementation is complete per the plan's task list,
   run `bash test/smoke.sh` (create it per the plan if not yet created) and
   fix any failures. Iterate until it exits 0. Also manually sanity-check
   with a couple of `curl` calls if useful.
5. Before you finish this iteration (regardless of whether the whole task is
   done yet), stage and commit all your changes to git with a clear,
   specific commit message describing what you added/fixed this iteration
   (e.g. `git add -A && git commit -m "step1 build: add groups API routes"`).
   NEVER leave uncommitted work at the end of an iteration — the next
   iteration and the final grader both depend on the committed state. Do not
   push (that is handled outside this process).
6. Only if, in THIS iteration, `npm install` succeeds, `npm start` boots the
   server without error, and `bash test/smoke.sh` exits 0 on a clean run —
   print the exact literal line `STEP1_COMPLETE` as the very last line of
   your final response, and nothing else on that line. Do NOT print
   `STEP1_COMPLETE` unless you just personally verified the smoke test
   passing in this iteration. If it is not yet fully working, do not print
   that token — just report concise progress instead (what you finished,
   what's left) so the next iteration knows where to continue.

Do not ask the user any questions — you are unattended. Make reasonable
decisions and keep moving. Do not modify `docs/step1-specify.md`,
`docs/step1-review.md`, or `docs/step1-plan.md`.
