'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { dollarsToCents, computeSplits, centsToString, computeBalances } = require('../balances');

// GET /api/groups
router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT id, name FROM groups ORDER BY id ASC').all();
  res.json(groups);
});

// POST /api/groups
router.post('/groups', (req, res) => {
  const { name, members } = req.body;

  // Validate group name
  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Group name must not be blank.' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'Group name must not exceed 100 characters.' });
  }

  // Validate members array
  if (!Array.isArray(members) || members.length === 0) {
    return res.status(400).json({ error: 'At least one member is required.' });
  }

  const trimmedNames = [];
  for (const m of members) {
    if (typeof m !== 'string' || m.trim() === '') {
      return res.status(400).json({ error: 'Member names must not be blank.' });
    }
    if (m.trim().length > 100) {
      return res.status(400).json({ error: 'Member names must not exceed 100 characters.' });
    }
    trimmedNames.push(m.trim());
  }

  // Case-insensitive uniqueness check
  const lowerNames = trimmedNames.map(n => n.toLowerCase());
  const uniqueNames = new Set(lowerNames);
  if (uniqueNames.size !== trimmedNames.length) {
    return res.status(400).json({ error: 'Member names must be unique within the group (case-insensitive).' });
  }

  // Insert in a transaction
  const insertGroup = db.prepare('INSERT INTO groups (name) VALUES (?)');
  const insertMember = db.prepare('INSERT INTO members (group_id, name) VALUES (?, ?)');

  const createGroup = db.transaction(() => {
    const groupResult = insertGroup.run(name);
    const groupId = groupResult.lastInsertRowid;
    const insertedMembers = [];
    for (const memberName of trimmedNames) {
      const memberResult = insertMember.run(groupId, memberName);
      insertedMembers.push({ id: Number(memberResult.lastInsertRowid), name: memberName });
    }
    return { id: Number(groupId), name, members: insertedMembers };
  });

  const group = createGroup();
  res.status(201).json(group);
});

// GET /api/groups/:id
router.get('/groups/:id', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id ASC').all(groupId);

  const expenseRows = db.prepare(
    'SELECT id, description, amount, paid_by, created_at FROM expenses WHERE group_id = ? ORDER BY created_at DESC'
  ).all(groupId);

  const expenses = expenseRows.map(exp => {
    const splits = db.prepare(
      'SELECT es.member_id, m.name AS member_name, es.share_amount FROM expense_splits es JOIN members m ON m.id = es.member_id WHERE es.expense_id = ? ORDER BY es.member_id ASC'
    ).all(exp.id);

    const paidByMember = members.find(m => m.id === exp.paid_by);

    return {
      id: exp.id,
      description: exp.description,
      amount: centsToString(exp.amount),
      paid_by: { id: exp.paid_by, name: paidByMember ? paidByMember.name : '' },
      created_at: exp.created_at,
      splits: splits.map(s => ({
        member_id: s.member_id,
        member_name: s.member_name,
        share_amount: centsToString(s.share_amount),
      })),
    };
  });

  // Build expense data for balance computation
  const expensesForBalance = expenseRows.map(exp => {
    const splits = db.prepare('SELECT member_id, share_amount FROM expense_splits WHERE expense_id = ?').all(exp.id);
    return { amount: exp.amount, paid_by: exp.paid_by, splits };
  });

  const balances = computeBalances(members, expensesForBalance);

  res.json({
    id: group.id,
    name: group.name,
    members: balances,
    expenses,
  });
});

// POST /api/groups/:id/expenses
router.post('/groups/:id/expenses', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const group = db.prepare('SELECT id FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    return res.status(404).json({ error: 'Group not found.' });
  }

  const { description, amount, paid_by, split_between } = req.body;

  // Validate description
  if (typeof description !== 'string' || description.trim() === '') {
    return res.status(400).json({ error: 'Description must not be blank.' });
  }
  if (description.trim().length > 200) {
    return res.status(400).json({ error: 'Description must not exceed 200 characters.' });
  }

  // Validate amount
  let amountCents;
  try {
    amountCents = dollarsToCents(amount);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  // Validate split_between
  if (!Array.isArray(split_between) || split_between.length === 0) {
    return res.status(400).json({ error: 'At least one member must be selected for the split.' });
  }

  // Check for duplicates
  const splitIds = split_between.map(id => Number(id));
  const uniqueSplitIds = new Set(splitIds);
  if (uniqueSplitIds.size !== splitIds.length) {
    return res.status(400).json({ error: 'split_between contains duplicate member IDs.' });
  }

  // Get all group members
  const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id ASC').all(groupId);
  const memberIdSet = new Set(members.map(m => m.id));

  // Validate paid_by
  const paidById = Number(paid_by);
  if (!memberIdSet.has(paidById)) {
    return res.status(400).json({ error: 'paid_by must be a member of this group.' });
  }

  // Validate split_between members
  for (const id of splitIds) {
    if (!memberIdSet.has(id)) {
      return res.status(400).json({ error: 'All split_between members must belong to this group.' });
    }
  }

  // Sort split_between by id ascending for deterministic rounding
  const sortedSplitIds = [...splitIds].sort((a, b) => a - b);
  const splits = computeSplits(amountCents, sortedSplitIds);

  const createdAt = new Date().toISOString();

  const insertExpense = db.prepare(
    'INSERT INTO expenses (group_id, description, amount, paid_by, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertSplit = db.prepare(
    'INSERT INTO expense_splits (expense_id, member_id, share_amount) VALUES (?, ?, ?)'
  );

  const createExpense = db.transaction(() => {
    const expResult = insertExpense.run(groupId, description.trim(), amountCents, paidById, createdAt);
    const expenseId = Number(expResult.lastInsertRowid);
    for (const s of splits) {
      insertSplit.run(expenseId, s.memberId, s.shareCents);
    }
    return expenseId;
  });

  const expenseId = createExpense();

  // Build response
  const paidByMember = members.find(m => m.id === paidById);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

  res.status(201).json({
    id: expenseId,
    description: description.trim(),
    amount: centsToString(amountCents),
    paid_by: { id: paidById, name: paidByMember.name },
    created_at: createdAt,
    splits: splits.map(s => ({
      member_id: s.memberId,
      member_name: memberMap[s.memberId],
      share_amount: centsToString(s.shareCents),
    })),
  });
});

module.exports = router;
