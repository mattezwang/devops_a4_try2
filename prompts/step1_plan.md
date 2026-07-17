You are working in the current git repository. This is stage "plan" of step 1
(base system) of SplitTab, a shared group-expense tracker.

Two documents already exist and together are authoritative:
- `docs/step1-specify.md` (the spec)
- `docs/step1-review.md` (a review with a "Resolved spec addendum" section
  that takes precedence over the original spec where they conflict)

Read both in full.

Your ONLY job in this stage is to write an implementation plan. Do NOT write
any application code yet, do NOT run `npm install`, do NOT create
`package.json` or any source file. Just write the plan.

Create `docs/step1-plan.md` containing:

1. **File layout** — the exact list of files/directories to be created during
   the build stage, e.g.:
   - `package.json`
   - `src/index.js` (Express app entry point, starts server on `PORT` env var
     default 3000)
   - `src/db.js` (opens/creates the SQLite database file, e.g. `data.db`, and
     applies schema)
   - `src/routes/groups.js`, `src/routes/expenses.js` (or similar route
     modules)
   - `src/balances.js` (pure function(s) computing per-member balances from
     expenses/splits, and the cents-splitting/rounding helper from the
     addendum)
   - `public/` static assets if any (CSS)
   - `views/` or inline template functions for the two HTML pages (home,
     group detail) — state which approach you're picking and why (inline
     template literal functions are simplest given "no templating engine" is
     not mandated but simplicity is preferred)
   - `test/smoke.sh` — a bash script using `curl` (and `jq` if needed, or
     just grep) that: starts the server as a background process, waits for
     it to be ready, creates a group with 3 members, adds an expense that
     doesn't divide evenly, fetches the group and asserts (via exact string
     match or a small inline check) the balances match the corrected
     addendum example (Alice $14.66, Bob -$7.33, Carol -$7.33) and that they
     sum to zero, deletes the expense, asserts balances are back to
     "0.00" for all members, then kills the server and exits 0 on success /
     non-zero on any failed assertion.
   - `.gitignore` (must ignore `node_modules/` and the SQLite data file(s))
2. **Database schema** — the exact `CREATE TABLE` statements (SQLite dialect)
   for Group, Member, Expense, ExpenseSplit per the spec + addendum, with
   foreign keys and any indexes worth adding.
3. **Dependency list** — exact npm packages to install (e.g. `express`,
   `better-sqlite3`) and why each is needed. Keep the dependency list
   minimal.
4. **Endpoint-to-file mapping** — for each of the 5 API endpoints and 2 HTML
   routes in the spec, which file/function implements it.
5. **Balance/rounding implementation notes** — restate the exact algorithm
   from addendum A6 (string-based cents conversion) and A1/A2 (rounding
   distribution) as pseudocode, since this is the trickiest and most
   bug-prone part.
6. **Ordered task list** for the build stage — a numbered, dependency-ordered
   list of concrete implementation tasks (e.g. "1. package.json + deps, 2. db
   schema + db.js, 3. balances.js with unit-testable pure functions, 4.
   groups routes, 5. expenses routes, 6. HTML templates, 7. static CSS, 8.
   test/smoke.sh, 9. wire up index.js, 10. run smoke test and fix issues").
   This list is what the build-stage agent will work through.
7. **Definition of done** for step 1's build stage: `npm install && npm
   start` runs without error, the server listens on port 3000, and
   `bash test/smoke.sh` exits 0.

When you are done writing `docs/step1-plan.md`, stop. Do not commit, do not
push, do not write any code yet. Print the text PLAN_WRITTEN as the last line
of your output once the file exists and looks complete.
