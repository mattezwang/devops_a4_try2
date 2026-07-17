'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { centsToString, computeBalances, simplifyDebts } = require('../balances');

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

  // Suggested settlements section
  const suggestedSettlementsHtml = group.suggested_settlements.length === 0
    ? '<p class="empty-state">All balances are settled — no payments needed.</p>'
    : `<div class="suggested-settlements">${group.suggested_settlements.map(s =>
        `<div class="settlement-suggestion">
          ${escapeHtml(s.from.name)} pays ${escapeHtml(s.to.name)} <strong>$${escapeHtml(s.amount)}</strong>
          <button class="record-suggestion-btn"
                  data-from="${s.from.id}"
                  data-to="${s.to.id}"
                  data-amount="${escapeHtml(s.amount)}">Record this payment</button>
        </div>`
      ).join('')}</div>`;

  // Activity feed
  const activityList = group.feed.length === 0
    ? '<p class="empty-state">No activity yet.</p>'
    : group.feed.map(item => {
        if (item.type === 'expense') {
          const splitNames = item.splits.map(s => escapeHtml(s.member_name)).join(', ');
          return `<div class="activity-item">
            <div class="expense-info">
              <strong>${escapeHtml(item.description)}</strong>
              — $${escapeHtml(item.amount)}
              paid by <em>${escapeHtml(item.paid_by.name)}</em>
              split between: ${splitNames}
            </div>
            <button class="delete-btn" data-expense-id="${item.id}">Delete</button>
          </div>`;
        } else {
          return `<div class="activity-item">
            <div class="expense-info">
              ${escapeHtml(item.from_member.name)} paid ${escapeHtml(item.to_member.name)}
              <strong>$${escapeHtml(item.amount)}</strong>
              <span class="settlement-tag">[settlement]</span>
            </div>
            <button class="delete-btn" data-settlement-id="${item.id}">Delete</button>
          </div>`;
        }
      }).join('');

  const memberOptions = group.members.map(m =>
    `<option value="${m.id}">${escapeHtml(m.name)}</option>`
  ).join('');

  const splitCheckboxes = group.members.map(m =>
    `<label><input type="checkbox" name="split_between" value="${m.id}"> ${escapeHtml(m.name)}</label>`
  ).join('');

  const exactInputs = group.members.map(m =>
    `<div class="split-row">
      <label>${escapeHtml(m.name)}</label>
      <input type="text" class="exact-amount" data-member-id="${m.id}" placeholder="0.00">
    </div>`
  ).join('');

  const pctInputs = group.members.map(m =>
    `<div class="split-row">
      <label>${escapeHtml(m.name)}</label>
      <input type="number" class="pct-amount" data-member-id="${m.id}" step="0.01" min="0.01" placeholder="0">
    </div>`
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

    <h2>Suggested Settlements</h2>
    ${suggestedSettlementsHtml}

    <h2>Record a Payment</h2>
    <form id="record-payment-form" class="record-payment">
      <div class="form-group">
        <label for="pay-from">Who paid</label>
        <select id="pay-from">${memberOptions}</select>
      </div>
      <div class="form-group">
        <label for="pay-to">Who received</label>
        <select id="pay-to">${memberOptions}</select>
      </div>
      <div class="form-group">
        <label for="pay-amount">Amount ($)</label>
        <input type="text" id="pay-amount" placeholder="7.33">
      </div>
      <button type="submit">Record Payment</button>
      <p id="payment-error" class="error" style="display:none"></p>
    </form>

    <h2>Activity</h2>
    <div id="activity-list">${activityList}</div>

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
        <label for="exp-split-type">Split type</label>
        <select id="exp-split-type">
          <option value="equal">Equal</option>
          <option value="exact">Exact amounts</option>
          <option value="percentage">Percentage</option>
        </select>
      </div>
      <div id="panel-equal" class="form-group">
        <label>Split between</label>
        <div class="checkboxes">${splitCheckboxes}</div>
      </div>
      <div id="panel-exact" class="form-group" style="display:none">
        <label>Exact amounts ($)</label>
        ${exactInputs}
      </div>
      <div id="panel-pct" class="form-group" style="display:none">
        <label>Percentages (%)</label>
        ${pctInputs}
      </div>
      <button type="submit">Add Expense</button>
      <p id="expense-error" class="error" style="display:none"></p>
    </form>
  </div>
  <script>
    // Delete buttons (expense or settlement)
    document.querySelectorAll('.delete-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const expId = this.dataset.expenseId;
        const setId = this.dataset.settlementId;
        const url = expId ? '/api/expenses/' + expId : '/api/settlements/' + setId;
        const resp = await fetch(url, { method: 'DELETE' });
        if (resp.ok) {
          window.location.reload();
        } else {
          alert(expId ? 'Failed to delete expense.' : 'Failed to delete settlement.');
        }
      });
    });

    // Record suggestion buttons
    document.querySelectorAll('.record-suggestion-btn').forEach(function(btn) {
      btn.addEventListener('click', async function() {
        const body = {
          from_member_id: parseInt(this.dataset.from, 10),
          to_member_id:   parseInt(this.dataset.to, 10),
          amount:         this.dataset.amount,
        };
        const resp = await fetch('/api/groups/${group.id}/settlements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        if (resp.ok) {
          window.location.reload();
        } else {
          const data = await resp.json();
          alert(data.error || 'Failed to record settlement.');
        }
      });
    });

    // Record payment form
    document.getElementById('record-payment-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const from_member_id = parseInt(document.getElementById('pay-from').value, 10);
      const to_member_id   = parseInt(document.getElementById('pay-to').value, 10);
      const amount         = document.getElementById('pay-amount').value;
      const errEl = document.getElementById('payment-error');
      errEl.style.display = 'none';
      try {
        const resp = await fetch('/api/groups/${group.id}/settlements', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ from_member_id, to_member_id, amount }),
        });
        const data = await resp.json();
        if (!resp.ok) {
          errEl.textContent = data.error || 'Error recording payment.';
          errEl.style.display = 'block';
          return;
        }
        window.location.reload();
      } catch (err) {
        errEl.textContent = 'Network error.';
        errEl.style.display = 'block';
      }
    });

    // Split type panel show/hide
    document.getElementById('exp-split-type').addEventListener('change', function() {
      document.getElementById('panel-equal').style.display = this.value === 'equal'      ? '' : 'none';
      document.getElementById('panel-exact').style.display = this.value === 'exact'      ? '' : 'none';
      document.getElementById('panel-pct').style.display   = this.value === 'percentage' ? '' : 'none';
    });

    // Add expense form
    document.getElementById('add-expense-form').addEventListener('submit', async function(e) {
      e.preventDefault();
      const description = document.getElementById('exp-description').value;
      const amount      = document.getElementById('exp-amount').value;
      const paid_by     = parseInt(document.getElementById('exp-paid-by').value, 10);
      const split_type  = document.getElementById('exp-split-type').value;
      const errEl       = document.getElementById('expense-error');
      errEl.style.display = 'none';

      const body = { description, amount, paid_by, split_type };

      if (split_type === 'equal') {
        const checkboxes = document.querySelectorAll('input[name="split_between"]:checked');
        body.split_between = Array.from(checkboxes).map(cb => parseInt(cb.value, 10));
      } else if (split_type === 'exact') {
        const inputs = document.querySelectorAll('.exact-amount');
        body.splits = Array.from(inputs)
          .filter(inp => inp.value && inp.value.trim() !== '')
          .map(inp => ({ member_id: parseInt(inp.dataset.memberId, 10), amount: inp.value.trim() }));
      } else if (split_type === 'percentage') {
        const inputs = document.querySelectorAll('.pct-amount');
        body.splits = Array.from(inputs)
          .filter(inp => inp.value && parseFloat(inp.value) > 0)
          .map(inp => ({ member_id: parseInt(inp.dataset.memberId, 10), percentage: parseFloat(inp.value) }));
      }

      try {
        const resp = await fetch('/api/groups/${group.id}/expenses', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
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

  const expensesForBalance = expenseRows.map(exp => {
    const splits = db.prepare('SELECT member_id, share_amount FROM expense_splits WHERE expense_id = ?').all(exp.id);
    return { amount: exp.amount, paid_by: exp.paid_by, splits };
  });

  const settlementRows = db.prepare(
    'SELECT id, from_member_id, to_member_id, amount, created_at FROM settlements WHERE group_id = ? ORDER BY created_at DESC'
  ).all(groupId);

  const balances = computeBalances(members, expensesForBalance, settlementRows);
  const suggestedSettlements = simplifyDebts(balances);

  const feedExpenses = expenses.map(exp => ({ type: 'expense', ...exp }));
  const feedSettlements = settlementRows.map(s => {
    const fromMember = members.find(m => m.id === s.from_member_id);
    const toMember   = members.find(m => m.id === s.to_member_id);
    return {
      type: 'settlement',
      id: s.id,
      created_at: s.created_at,
      from_member: { id: s.from_member_id, name: fromMember ? fromMember.name : '' },
      to_member:   { id: s.to_member_id,   name: toMember   ? toMember.name   : '' },
      amount: centsToString(s.amount),
    };
  });

  const feed = [...feedExpenses, ...feedSettlements].sort((a, b) => {
    if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
    if (a.type !== b.type) return a.type < b.type ? -1 : 1;
    return b.id - a.id;
  });

  res.send(groupPage({
    id: group.id,
    name: group.name,
    members: balances,
    suggested_settlements: suggestedSettlements,
    expenses,
    feed,
  }));
});

module.exports = router;
