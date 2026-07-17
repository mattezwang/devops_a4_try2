# Running SplitTab

SplitTab is a shared group-expense tracker (a mini Splitwise). Node.js +
Express backend, SQLite storage (via `better-sqlite3`), plain server-rendered
HTML/CSS/vanilla-JS frontend — no build step, no framework.

## Prerequisites

- Node.js 18+ (tested on Node 25)
- npm

## Install and run

```bash
npm install
npm start
```

The server listens on `http://localhost:3000` (override with `PORT=xxxx npm
start`). Open that URL in a browser. Data is stored in a local SQLite file
(`data.db`, created automatically on first run, git-ignored).

## Using the app

1. On the home page (`/`), create a group with a name and a comma-free list
   of member names (one per input field).
2. Click into the group (`/groups/:id`) to:
   - Add an expense: description, amount, who paid, and a split type:
     - **Equal** — split evenly among the members you check.
     - **Exact** — enter each selected member's exact dollar share (must sum
       to the total).
     - **Percentage** — enter each selected member's percentage (must sum to
       100).
   - See each member's live balance, a chronological activity feed of
     expenses + settlements, and a "Suggested settlements" list (the minimal
     set of payments that would zero out everyone's balance).
   - Record a settlement (who paid whom how much) to reduce balances, or
     delete an expense/settlement to reverse its effect.

## Running the automated smoke test

An end-to-end test drives the running server with `curl` and checks the
balance math, custom splits, debt simplification, and settle-up/undo:

```bash
npm start &          # in one terminal, or let the script start it
bash test/smoke.sh   # starts its own server instance on :3000, runs
                      # assertions for both the base system and the
                      # extension, then shuts the server down
```

`test/smoke.sh` starts and stops its own server process, so you do not need
`npm start` running separately — just run the script directly:

```bash
bash test/smoke.sh
```

It exits `0` and prints `All smoke tests passed (step 1 + step 2)!` when
everything works. Requires `curl` and `jq` (both preinstalled on most
systems; install via `brew install jq` / `apt install jq` if missing).

## Project layout

```
src/
  index.js            Express app entry point
  db.js               SQLite schema + migrations
  balances.js         Pure balance/split/rounding/debt-simplification logic
  routes/
    groups.js         Group + expense API routes
    expenses.js        Expense delete route
    settlements.js     Settlement create/delete routes
    pages.js           Server-rendered HTML pages
public/style.css       Stylesheet
test/smoke.sh           End-to-end smoke test (step 1 + step 2)
docs/                   Spec / review / plan documents for each stage
prompts/                Prompt files sent to the AI agent for each stage
```

## How this was built (for context)

This project was built with `loop.sh` (a "ralph wiggum"-style loop that
repeatedly invokes `claude -p` non-interactively and pushes after every
iteration) in two steps — base system, then an extension — each split into
specify → review → plan → build stages. See `prompts.txt` for the full
transcript of every prompt given to the agent, and `docs/` for the spec,
review, and plan artifact produced at each stage.
