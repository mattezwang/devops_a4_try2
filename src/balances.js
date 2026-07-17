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

// Format integer cents as a signed dollar string with exactly 2 decimal places.
function centsToString(cents) {
  if (cents === 0) return '0.00';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const pennies = abs % 100;
  return sign + String(dollars) + '.' + String(pennies).padStart(2, '0');
}

// Compute net balances for each member.
// members: [{ id, name }]
// expenses: [{ amount, paid_by, splits: [{ member_id, share_amount }] }]
// Returns [{ id, name, balance: string }]
function computeBalances(members, expenses) {
  const paidMap = {};
  const owedMap = {};

  for (const m of members) {
    paidMap[m.id] = 0;
    owedMap[m.id] = 0;
  }

  for (const expense of expenses) {
    paidMap[expense.paid_by] += expense.amount;
    for (const split of expense.splits) {
      owedMap[split.member_id] += split.share_amount;
    }
  }

  return members.map(m => ({
    id: m.id,
    name: m.name,
    balance: centsToString(paidMap[m.id] - owedMap[m.id]),
  }));
}

module.exports = { dollarsToCents, computeSplits, centsToString, computeBalances };
