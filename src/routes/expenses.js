'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');

// DELETE /api/expenses/:id
router.delete('/expenses/:id', (req, res) => {
  const expenseId = parseInt(req.params.id, 10);
  if (isNaN(expenseId)) {
    return res.status(404).json({ error: 'Expense not found.' });
  }

  const expense = db.prepare('SELECT id FROM expenses WHERE id = ?').get(expenseId);
  if (!expense) {
    return res.status(404).json({ error: 'Expense not found.' });
  }

  const deleteSplits = db.prepare('DELETE FROM expense_splits WHERE expense_id = ?');
  const deleteExpense = db.prepare('DELETE FROM expenses WHERE id = ?');

  db.transaction(() => {
    deleteSplits.run(expenseId);
    deleteExpense.run(expenseId);
  })();

  res.json({ deleted: true, expense_id: expenseId });
});

module.exports = router;
