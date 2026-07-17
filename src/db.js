'use strict';

const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, '..', 'data.db'));

db.pragma('foreign_keys = ON');

db.exec(`
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
    amount      INTEGER NOT NULL,
    paid_by     INTEGER NOT NULL REFERENCES members(id),
    created_at  TEXT    NOT NULL
  );

  CREATE TABLE IF NOT EXISTS expense_splits (
    expense_id   INTEGER NOT NULL REFERENCES expenses(id),
    member_id    INTEGER NOT NULL REFERENCES members(id),
    share_amount INTEGER NOT NULL,
    PRIMARY KEY (expense_id, member_id)
  );

  CREATE TABLE IF NOT EXISTS settlements (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id       INTEGER NOT NULL REFERENCES groups(id),
    from_member_id INTEGER NOT NULL REFERENCES members(id),
    to_member_id   INTEGER NOT NULL REFERENCES members(id),
    amount         INTEGER NOT NULL,
    created_at     TEXT    NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_members_group_id      ON members(group_id);
  CREATE INDEX IF NOT EXISTS idx_expenses_group_id     ON expenses(group_id);
  CREATE INDEX IF NOT EXISTS idx_splits_expense_id     ON expense_splits(expense_id);
  CREATE INDEX IF NOT EXISTS idx_splits_member_id      ON expense_splits(member_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_group_id  ON settlements(group_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_from_member ON settlements(from_member_id);
  CREATE INDEX IF NOT EXISTS idx_settlements_to_member   ON settlements(to_member_id);
`);

// Idempotent migration: add split_type column if not present (addendum A1)
const expenseCols = db.prepare('PRAGMA table_info(expenses)').all();
if (!expenseCols.some(c => c.name === 'split_type')) {
  db.exec("ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'");
}

module.exports = db;
