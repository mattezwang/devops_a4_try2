'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  dollarsToCents,
  computeSplits,
  computePercentageSplits,
  centsToString,
  computeBalances,
  simplifyDebts,
} = require('../balances');

// GET /api/groups
router.get('/groups', (req, res) => {
  const groups = db.prepare('SELECT id, name FROM groups ORDER BY id ASC').all();
  res.json(groups);
});

// POST /api/groups
router.post('/groups', (req, res) => {
  const { name, members } = req.body;

  if (typeof name !== 'string' || name.trim() === '') {
    return res.status(400).json({ error: 'Group name must not be blank.' });
  }
  if (name.trim().length > 100) {
    return res.status(400).json({ error: 'Group name must not exceed 100 characters.' });
  }

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

  const lowerNames = trimmedNames.map(n => n.toLowerCase());
  const uniqueNames = new Set(lowerNames);
  if (uniqueNames.size !== trimmedNames.length) {
    return res.status(400).json({ error: 'Member names must be unique within the group (case-insensitive).' });
  }

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
    'SELECT id, description, amount, paid_by, created_at, split_type FROM expenses WHERE group_id = ? ORDER BY created_at DESC'
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
      split_type: exp.split_type || 'equal',
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

  // Get settlements
  const settlementRows = db.prepare(
    'SELECT id, from_member_id, to_member_id, amount, created_at FROM settlements WHERE group_id = ? ORDER BY created_at DESC'
  ).all(groupId);

  // Compute balances with settlements
  const balances = computeBalances(members, expensesForBalance, settlementRows);

  // Compute suggested settlements
  const suggestedSettlements = simplifyDebts(balances);

  // Build feed items from expenses
  const feedExpenses = expenses.map(exp => ({ type: 'expense', ...exp }));

  // Build feed items from settlements
  const feedSettlements = settlementRows.map(s => {
    const fromMember = members.find(m => m.id === s.from_member_id);
    const toMember = members.find(m => m.id === s.to_member_id);
    return {
      type: 'settlement',
      id: s.id,
      created_at: s.created_at,
      from_member: { id: s.from_member_id, name: fromMember ? fromMember.name : '' },
      to_member:   { id: s.to_member_id,   name: toMember   ? toMember.name   : '' },
      amount: centsToString(s.amount),
    };
  });

  // Merge and sort feed: created_at DESC, type ASC, id DESC
  const feed = [...feedExpenses, ...feedSettlements].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return b.id - a.id;
  });

  res.json({
    id: group.id,
    name: group.name,
    members: balances,
    suggested_settlements: suggestedSettlements,
    expenses,
    feed,
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

  const { description, amount, paid_by, split_type, split_between, splits } = req.body;

  // 1. Validate description
  if (typeof description !== 'string' || description.trim() === '') {
    return res.status(400).json({ error: 'Description must not be blank.' });
  }
  if (description.trim().length > 200) {
    return res.status(400).json({ error: 'Description must not exceed 200 characters.' });
  }

  // 2. Validate amount
  let amountCents;
  try {
    amountCents = dollarsToCents(amount);
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  // 3. Validate split_type
  const effectiveSplitType = split_type === undefined ? 'equal' : split_type;
  if (!['equal', 'exact', 'percentage'].includes(effectiveSplitType)) {
    return res.status(400).json({ error: 'Invalid split_type. Must be one of: equal, exact, percentage.' });
  }

  // Get all group members (needed for membership validation)
  const members = db.prepare('SELECT id, name FROM members WHERE group_id = ? ORDER BY id ASC').all(groupId);
  const memberIdSet = new Set(members.map(m => m.id));

  let computedSplits; // array of { memberId, shareCents }

  if (effectiveSplitType === 'equal') {
    // 4a. Validate split_between per step-1 rules
    if (!Array.isArray(split_between) || split_between.length === 0) {
      return res.status(400).json({ error: 'At least one member must be selected for the split.' });
    }
    const splitIds = split_between.map(id => Number(id));
    const uniqueSplitIds = new Set(splitIds);
    if (uniqueSplitIds.size !== splitIds.length) {
      return res.status(400).json({ error: 'split_between contains duplicate member IDs.' });
    }
    for (const id of splitIds) {
      if (!memberIdSet.has(id)) {
        return res.status(400).json({ error: 'All split_between members must belong to this group.' });
      }
    }
    const sortedSplitIds = [...splitIds].sort((a, b) => a - b);
    computedSplits = computeSplits(amountCents, sortedSplitIds);

  } else {
    // 4b. Validate splits array (exact or percentage)
    if (!Array.isArray(splits) || splits.length === 0) {
      return res.status(400).json({ error: 'At least one member must be selected for the split.' });
    }

    // Check duplicate member_ids
    const splitMemberIds = splits.map(s => Number(s.member_id));
    const uniqueSplitMemberIds = new Set(splitMemberIds);
    if (uniqueSplitMemberIds.size !== splitMemberIds.length) {
      return res.status(400).json({ error: 'splits contains duplicate member IDs.' });
    }

    // Check membership
    for (const id of splitMemberIds) {
      if (!memberIdSet.has(id)) {
        return res.status(400).json({ error: 'All split members must belong to this group.' });
      }
    }

    if (effectiveSplitType === 'exact') {
      // Validate each amount
      const splitCents = [];
      for (const s of splits) {
        let cents;
        try {
          cents = dollarsToCents(s.amount);
        } catch (err) {
          return res.status(err.status || 400).json({ error: err.message });
        }
        splitCents.push({ memberId: Number(s.member_id), shareCents: cents });
      }

      // Validate sum
      const totalSplit = splitCents.reduce((acc, s) => acc + s.shareCents, 0);
      if (totalSplit !== amountCents) {
        return res.status(400).json({ error: 'Exact split amounts must sum to the expense total.' });
      }

      computedSplits = splitCents;

    } else {
      // percentage
      // Validate each percentage
      const pctSplits = [];
      for (const s of splits) {
        const pct = s.percentage;
        if (typeof pct !== 'number' || isNaN(pct) || pct <= 0) {
          return res.status(400).json({ error: 'Each percentage must be a positive number.' });
        }
        pctSplits.push({ memberId: Number(s.member_id), percentage: pct });
      }

      // Validate sum
      const sumPct = pctSplits.reduce((acc, s) => acc + s.percentage, 0);
      if (Math.round(sumPct * 100) !== 10000) {
        return res.status(400).json({ error: 'Percentage splits must sum to exactly 100.00.' });
      }

      computedSplits = computePercentageSplits(amountCents, pctSplits);
    }
  }

  // 5. Validate paid_by (last, per addendum A3)
  const paidById = Number(paid_by);
  if (!memberIdSet.has(paidById)) {
    return res.status(400).json({ error: 'paid_by must be a member of this group.' });
  }

  const createdAt = new Date().toISOString();

  const insertExpense = db.prepare(
    'INSERT INTO expenses (group_id, description, amount, paid_by, created_at, split_type) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const insertSplit = db.prepare(
    'INSERT INTO expense_splits (expense_id, member_id, share_amount) VALUES (?, ?, ?)'
  );

  const createExpense = db.transaction(() => {
    const expResult = insertExpense.run(groupId, description.trim(), amountCents, paidById, createdAt, effectiveSplitType);
    const expenseId = Number(expResult.lastInsertRowid);
    for (const s of computedSplits) {
      insertSplit.run(expenseId, s.memberId, s.shareCents);
    }
    return expenseId;
  });

  const expenseId = createExpense();

  // Build response — splits sorted by member_id ASC
  const paidByMember = members.find(m => m.id === paidById);
  const memberMap = Object.fromEntries(members.map(m => [m.id, m.name]));

  const responseSplits = [...computedSplits]
    .sort((a, b) => a.memberId - b.memberId)
    .map(s => ({
      member_id: s.memberId,
      member_name: memberMap[s.memberId],
      share_amount: centsToString(s.shareCents),
    }));

  res.status(201).json({
    id: expenseId,
    description: description.trim(),
    amount: centsToString(amountCents),
    split_type: effectiveSplitType,
    paid_by: { id: paidById, name: paidByMember.name },
    created_at: createdAt,
    splits: responseSplits,
  });
});

module.exports = router;
