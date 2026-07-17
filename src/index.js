'use strict';

const express = require('express');
const path = require('path');

const groupsRouter = require('./routes/groups');
const expensesRouter = require('./routes/expenses');
const pagesRouter = require('./routes/pages');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', groupsRouter);
app.use('/api', expensesRouter);
app.use('/', pagesRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`SplitTab listening on port ${PORT}`);
});
