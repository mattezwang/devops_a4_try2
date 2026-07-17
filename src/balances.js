'use strict';

// Convert a dollar string to integer cents using string splitting (no float arithmetic).
// Throws an object { status: 400, message: '...' } on invalid input.
function dollarsToCents(str) {
  if (typeof str !== 'string' || str === '' || /[^0-9.]/.test(str)) {
    throw { status: 400, message: 'Invalid amount.' };
  }

  const parts = str.split('.');

  if (parts.length > 2) {
    throw { status: 400, message: 'Invalid amount.' };
  }

  const intPart = parseInt(parts[0], 10);
  if (isNaN(intPart)) {
    throw { status: 400, message: 'Invalid amount.' };
  }

  let cents;
  if (parts.length === 1) {
    cents = intPart * 100;
  } else {
    const fracStr = parts[1];
    if (fracStr.length === 0 || fracStr.length > 2) {
      throw { status: 400, message: 'Amount must have at most 2 decimal places.' };
    }
    const fracDigits = parseInt(fracStr, 10);
    if (fracStr.length === 1) {
      cents = intPart * 100 + fracDigits * 10;
    } else {
      cents = intPart * 100 + fracDigits;
    }
  }

  if (cents <= 0) {
    throw { status: 400, message: 'Amount must be a positive number.' };
  }
  if (cents > 99_999_999) {
    throw { status: 400, message: 'Amount exceeds maximum ($999,999.99).' };
  }

  return cents;
}

// Compute how to split totalCents among memberIds (sorted ascending).
// Returns array of { memberId, shareCents }.
function computeSplits(totalCents, memberIds) {
  const n = memberIds.length;
  const baseShare = Math.floor(totalCents / n);
  const remainder = totalCents % n;

  return memberIds.map((memberId, i) => ({
    memberId,
    shareCents: baseShare + (i < remainder ? 1 : 0),
  }));
}

// Compute percentage-based splits. Returns array of { memberId, shareCents }.
// Input splits: [{ memberId, percentage }] (already validated: percentages > 0, sum ≈ 100.00)
function computePercentageSplits(totalCents, splits) {
  // Sort by percentage DESC, then memberId ASC for ties
  const sorted = [...splits].sort((a, b) =>
    b.percentage !== a.percentage
      ? b.percentage - a.percentage
      : a.memberId - b.memberId
  );

  // Compute floor amounts
  const withFloor = sorted.map(s => ({
    memberId: s.memberId,
    floorCents: Math.floor(totalCents * s.percentage / 100),
    percentage: s.percentage,
  }));

  // Compute remainder
  const totalFloor = withFloor.reduce((acc, s) => acc + s.floorCents, 0);
  let remainder = totalCents - totalFloor;

  // Addendum A4: defensive clamp
  remainder = Math.max(0, Math.min(remainder, withFloor.length));

  // Distribute remainder (+1 cent to the first `remainder` entries in sorted order)
  return withFloor.map((s, i) => ({
    memberId: s.memberId,
    shareCents: s.floorCents + (i < remainder ? 1 : 0),
  }));
}

// Format integer cents as a signed dollar string with exactly 2 decimal places.
function centsToString(cents) {
  if (cents === 0) return '0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const pennies = abs % 100;
  return sign + String(dollars) + '.' + String(pennies).padStart(2, '0');
}

// Parse centsToString output back to a signed integer. Private helper for simplifyDebts.
function balanceStringToCents(str) {
  const neg = str.startsWith('-');
  const abs = neg ? str.slice(1) : str;
  const [d, c] = abs.split('.');
  return (parseInt(d, 10) * 100 + parseInt(c, 10)) * (neg ? -1 : 1);
}

// Compute net balances for each member, incorporating settlements.
// members:     [{ id, name }]
// expenses:    [{ amount, paid_by, splits: [{ member_id, share_amount }] }]
// settlements: [{ from_member_id, to_member_id, amount }]  (optional, defaults to [])
// Returns [{ id, name, balance: string }]
function computeBalances(members, expenses, settlements = []) {
  const paidMap       = {};
  const owedMap       = {};
  const settledOutMap = {};
  const settledInMap  = {};

  for (const m of members) {
    paidMap[m.id]       = 0;
    owedMap[m.id]       = 0;
    settledOutMap[m.id] = 0;
    settledInMap[m.id]  = 0;
  }

  for (const expense of expenses) {
    paidMap[expense.paid_by] += expense.amount;
    for (const split of expense.splits) {
      owedMap[split.member_id] += split.share_amount;
    }
  }

  for (const s of settlements) {
    settledOutMap[s.from_member_id] += s.amount;
    settledInMap[s.to_member_id]    += s.amount;
  }

  return members.map(m => ({
    id:      m.id,
    name:    m.name,
    balance: centsToString(
      paidMap[m.id] - owedMap[m.id] + settledOutMap[m.id] - settledInMap[m.id]
    ),
  }));
}

// Greedy debt-simplification algorithm (spec §4.1).
// Input:  array returned by computeBalances — [{ id, name, balance: string }]
// Output: [{ from: { id, name }, to: { id, name }, amount: string }]
function simplifyDebts(membersWithBalances) {
  const credits = [];
  const debts   = [];
  for (const m of membersWithBalances) {
    const cents = balanceStringToCents(m.balance);
    if (cents > 0) credits.push({ id: m.id, name: m.name, balanceCents: cents });
    if (cents < 0) debts.push({   id: m.id, name: m.name, balanceCents: cents });
  }

  const transactions = [];

  while (credits.length > 0 && debts.length > 0) {
    // Largest creditor: highest balanceCents, tie → lowest id
    credits.sort((a, b) =>
      b.balanceCents !== a.balanceCents ? b.balanceCents - a.balanceCents : a.id - b.id
    );
    // Largest debtor by magnitude: most negative balanceCents, tie → lowest id
    debts.sort((a, b) =>
      a.balanceCents !== b.balanceCents ? a.balanceCents - b.balanceCents : a.id - b.id
    );

    const C = credits[0];
    const D = debts[0];
    const amount = Math.min(C.balanceCents, -D.balanceCents);

    transactions.push({
      from:   { id: D.id, name: D.name },
      to:     { id: C.id, name: C.name },
      amount: centsToString(amount),
    });

    C.balanceCents -= amount;
    D.balanceCents += amount;

    if (C.balanceCents === 0) credits.shift();
    if (D.balanceCents === 0) debts.shift();
  }

  return transactions;
}

module.exports = {
  dollarsToCents,
  computeSplits,
  computePercentageSplits,
  centsToString,
  computeBalances,
  simplifyDebts,
};
