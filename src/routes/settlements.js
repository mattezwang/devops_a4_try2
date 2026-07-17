'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { dollarsToCents, centsToString, computeBalances, simplifyDebts } = require('../balances');

// GET /api/groups/:id/settlements/suggested
router.get('/groups/:id/settlements/suggested', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id ASC').all(groupId);

  const expenseRows = db.prepare('SELECT id, amount, paid_by FROM expenses WHERE group_id = ?').all(groupId);
  const expensesForBalance = expenseRows.map(exp => {
    const splits = db.prepare('SELECT member_id, share_amount FROM expense_splits WHERE expense_id = ?').all(exp.id);
    return { amount: exp.amount, paid_by: exp.paid_by, splits };
  });

  const settlementRows = db.prepare(
    'SELECT from_member_id, to_member_id, amount FROM settlements WHERE group_id = ?'
  ).all(groupId);

  const balances = computeBalances(members, expensesForBalance, settlementRows);
  const suggestedSettlements = simplifyDebts(balances);

  res.json({ suggested_settlements: suggestedSettlements });
});

// POST /api/groups/:id/settlements
router.post('/groups/:id/settlements', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const { from_member_id, to_member_id, amount } = req.body;

  const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id ASC').all(groupId);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

  const fromId = Number(from_member_id);
  const toId   = Number(to_member_id);

  // Validate from_member_id
  if (!memberMap.hasOwnProperty(fromId)) {
    return res.status(400).json({ error: 'from_member_id must be a member of this group.' });
  }

  // Validate to_member_id
  if (!memberMap.hasOwnProperty(toId)) {
    return res.status(400).json({ error: 'to_member_id must be a member of this group.' });
  }

  // Self-settlement check
  if (fromId === toId) {
    return res.status(400).json({ error: 'A member cannot settle with themselves.' });
  }

  // Validate amount
  let amountCents;
  try {
    amountCents = dollarsToCents(amount);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  const createdAt = new Date().toISOString();

  const result = db.prepare(
    'INSERT INTO settlements (group_id, from_member_id, to_member_id, amount, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(groupId, fromId, toId, amountCents, createdAt);

  const settlementId = Number(result.lastInsertRowid);

  res.status(201).json({
    id: settlementId,
    group_id: groupId,
    from_member_id:   fromId,
    from_member_name: memberMap[fromId],
    to_member_id:     toId,
    to_member_name:   memberMap[toId],
    amount:           centsToString(amountCents),
    created_at:       createdAt,
  });
});

// DELETE /api/settlements/:id
router.delete('/settlements/:id', (req, res) => {
  const settlementId = parseInt(req.params.id, 10);
  if (isNaN(settlementId)) {
    return res.status(404).json({ error: 'Settlement not found.' });
  }

  const settlement = db.prepare('SELECT id FROM settlements WHERE id = ?').get(settlementId);
  if (!settlement) {
    return res.status(404).json({ error: 'Settlement not found.' });
  }

  db.prepare('DELETE FROM settlements WHERE id = ?').run(settlementId);

  res.json({ deleted: true, settlement_id: settlementId });
});

module.exports = router;
