'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { centsToString, computeBalances } = require('../balances');

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBalance(balanceStr) {
  if (balanceStr === '0.00') return '<span>$0.00</span>';
  if (balanceStr.startsWith('-')) {
    return `<span class="negative">-$${balanceStr.slice(1)}</span>`;
  }
  return `<span class="positive">+$${balanceStr}</span>`;
}

function homePage(groups) {
  const groupList = groups.length === 0
    ? '<p class="empty-state">No groups yet. Create one below!</p>'
    : `<ul class="group-list">${groups.map(g =>
        `<li><a href="/groups/${g.id}">${escapeHtml(g.name)}</a></li>`
      ).join('')}</ul>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SplitTab</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <h1>SplitTab</h1>
    <h2>Groups</h2>
    ${groupList}
    <h2>Create a New Group</h2>
    <form id="create-group-form">
      <div class="form-group">
        <label for="group-name">Group Name</label>
        <input type="text" id="group-name" name="name" required maxlength="100">
      </div>
      <div class="form-group">
        <label>Members (one per line)</label>
        <textarea id="members-input" rows="4" placeholder="Alice&#10;Bob&#10;Carol"></textarea>
      </div>
      <button type="submit">Create Group</button>
      <p id="form-error" class="error" style="display:none"></p>
    </form>
  </div>
  <script>
    document.getElementById('create-group-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const name = document.getElementById('group-name').value;
      const membersRaw = document.getElementById('members-input').value;
      const members = membersRaw.split('\\n').map(s => s.trim()).filter(s => s.length > 0);
      const errEl = document.getElementById('form-error');
      errEl.style.display = 'none';
      try {
        const resp = await fetch('/api/groups', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, members })
        });
        const data = await resp.json();
        if (!resp.ok) {
          errEl.textContent = data.error || 'Error creating group.';
          errEl.style.display = 'block';
          return;
        }
        window.location = '/groups/' + data.id;
      } catch (err) {
        errEl.textContent = 'Network error.';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

function groupPage(group) {
  const balanceRows = group.members.map(m =>
    `<tr><td>${escapeHtml(m.name)}</td><td>${formatBalance(m.balance)}</td></tr>`
  ).join('');

  const allZero = group.members.every(m => m.balance === '0.00');
  const balanceNote = allZero ? '<p class="empty-state">All balances are $0.00.</p>' : '';

  const expenseList = group.expenses.length === 0
    ? '<p class="empty-state">No expenses yet.</p>'
    : group.expenses.map(exp => {
        const splitNames = exp.splits.map(s => escapeHtml(s.member_name)).join(', ');
        return `<div class="expense-item">
          <div class="expense-info">
            <strong>${escapeHtml(exp.description)}</strong>
            — $${escapeHtml(exp.amount)}
            paid by <em>${escapeHtml(exp.paid_by.name)}</em>
            split between: ${splitNames}
          </div>
          <button class="delete-btn" data-expense-id="${exp.id}">Delete</button>
        </div>`;
      }).join('');

  const memberOptions = group.members.map(m =>
    `<option value="${m.id}">${escapeHtml(m.name)}</option>`
  ).join('');

  const splitCheckboxes = group.members.map(m =>
    `<label><input type="checkbox" name="split_between" value="${m.id}"> ${escapeHtml(m.name)}</label>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(group.name)} — SplitTab</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <div class="container">
    <p><a href="/">&larr; All Groups</a></p>
    <h1>${escapeHtml(group.name)}</h1>

    <h2>Balances</h2>
    ${balanceNote}
    <table class="balance-table">
      <thead><tr><th>Member</th><th>Balance</th></tr></thead>
      <tbody>${balanceRows}</tbody>
    </table>

    <h2>Expenses</h2>
    <div id="expense-list">${expenseList}</div>

    <h2>Add Expense</h2>
    <form id="add-expense-form">
      <div class="form-group">
        <label for="exp-description">Description</label>
        <input type="text" id="exp-description" required maxlength="200">
      </div>
      <div class="form-group">
        <label for="exp-amount">Amount ($)</label>
        <input type="text" id="exp-amount" required placeholder="22.00">
      </div>
      <div class="form-group">
        <label for="exp-paid-by">Paid by</label>
        <select id="exp-paid-by">${memberOptions}</select>
      </div>
      <div class="form-group">
        <label>Split between</label>
        <div class="checkboxes">${splitCheckboxes}</div>
      </div>
      <button type="submit">Add Expense</button>
      <p id="expense-error" class="error" style="display:none"></p>
    </form>
  </div>
  <script>
    document.querySelectorAll('.delete-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const id = this.dataset.expenseId;
        const resp = await fetch('/api/expenses/' + id, { method: 'DELETE' });
        if (resp.ok) {
          window.location.reload();
        } else {
          alert('Failed to delete expense.');
        }
      });
    });

    document.getElementById('add-expense-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const description = document.getElementById('exp-description').value;
      const amount = document.getElementById('exp-amount').value;
      const paid_by = parseInt(document.getElementById('exp-paid-by').value, 10);
      const checkboxes = document.querySelectorAll('input[name="split_between"]:checked');
      const split_between = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
      const errEl = document.getElementById('expense-error');
      errEl.style.display = 'none';
      try {
        const resp = await fetch('/api/groups/${group.id}/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ description, amount, paid_by, split_between })
        });
        const data = await resp.json();
        if (!resp.ok) {
          errEl.textContent = data.error || 'Error adding expense.';
          errEl.style.display = 'block';
          return;
        }
        window.location.reload();
      } catch (err) {
        errEl.textContent = 'Network error.';
        errEl.style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

// GET /
router.get('/', (req, res) => {
  const groups = db.prepare('SELECT id, name FROM groups ORDER BY id ASC').all();
  res.send(homePage(groups));
});

// GET /groups/:id
router.get('/groups/:id', (req, res) => {
  const groupId = parseInt(req.params.id, 10);
  if (isNaN(groupId)) {
    return res.status(404).send('<h1>404 — Group not found.</h1>');
  }

  const group = db.prepare('SELECT id, name FROM groups WHERE id = ?').get(groupId);
  if (!group) {
    return res.status(404).send('<h1>404 — Group not found.</h1>');
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

  const expensesForBalance = expenseRows.map(exp => {
    const splits = db.prepare('SELECT member_id, share_amount FROM expense_splits WHERE expense_id = ?').all(exp.id);
    return { amount: exp.amount, paid_by: exp.paid_by, splits };
  });

  const balances = computeBalances(members, expensesForBalance);

  res.send(groupPage({
    id: group.id,
    name: group.name,
    members: balances,
    expenses,
  }));
});

module.exports = router;
