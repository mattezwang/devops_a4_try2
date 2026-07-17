# SplitTab Step 1 — Spec Review

**Document reviewed:** `docs/step1-specify.md`
**Reviewer role:** Critical spec reviewer (did not author the spec)
**Verdict:** READY WITH FIXES

The spec is structurally sound: the entity model is clean, the rounding rule is deterministic, HTTP verbs and status codes are mostly correct, and several edge cases (last-expense deletion, zero balances, payer-not-in-split) are explicitly addressed. However, there is one critical inconsistency in the worked example (incorrect balance values), one misleading invariant statement, and several unspecified behaviors that would cause two independent implementers to make different choices. All issues are fixable with the addendum in §3 below.

---

## 1. Issues Found

### Issue 1 — Balance values in §5.3 JSON example contradict §6 and §7.1 (CRITICAL)

**Section:** §5.3 (`GET /api/groups/:id` response), cross-referencing §6 and §7.1

**Problem:** The example response shows Alice's balance as `"14.67"` and Bob's as `"-7.34"`. These are wrong. Applying the §6 balance formula with the §7.1 rounding rule to the exact splits shown in the *same example block*:

- Alice paid 2200 cents; her split share is 734 cents (shown as `"7.34"` in the splits array). Balance = 2200 − 734 = **1466 cents = $14.66**.
- Bob paid 0; his split share is 733 cents (shown as `"7.33"`). Balance = 0 − 733 = **−733 cents = −$7.33**.
- Carol paid 0; her split share is 733 cents. Balance = −733 cents = **−$7.33**.

The spec currently shows Alice `"14.67"`, Bob `"-7.34"`, Carol `"-7.33"`. Sum: 14.67 − 7.34 − 7.33 = 0.00 ✓ (sum is zero by coincidence), but the individual values are each off by $0.01. The error appears to be that the balance was computed with Alice's share treated as 733 cents despite the splits array correctly showing 734 cents.

**Proposed resolution:** Correct the balance values in the §5.3 example to `"14.66"`, `"-7.33"`, `"-7.33"`. The splits array in the same example is already correct and matches §7.1.

---

### Issue 2 — §6 invariant says "±1 cent" but §7.1 guarantees exact zero sum (MISLEADING)

**Section:** §6 (Balance Calculation Rule)

**Problem:** The invariant reads: *"The sum of all members' balances in a group must equal zero (subject to ±1 cent from rounding, resolved by the rule in §7)."* This wording implies it is acceptable for balances to sum to ±1 cent. In fact, the §7.1 rounding rule distributes remainder cents one-at-a-time so that `SUM(share_amount) = expense.amount` exactly for every expense. Since balance = total_paid − total_owed and `SUM(all_paid) = SUM(all expense amounts) = SUM(all share_amounts) = SUM(all_owed)`, the balance sum is exactly zero with no tolerance needed. An implementer reading "±1 cent" might use a simpler (non-deterministic) rounding approach under the assumption that 1-cent drift is acceptable, producing non-reproducible results.

**Proposed resolution:** Remove the parenthetical. The invariant should read: *"The sum of all members' balances in a group must equal zero exactly. The rounding rule in §7.1 guarantees this invariant is maintained."*

---

### Issue 3 — Duplicate member IDs in `split_between` are unspecified

**Section:** §5.4 (`POST /api/groups/:id/expenses`), §4.4

**Problem:** The spec does not say what happens when the `split_between` array contains a duplicate member ID, e.g., `[7, 7, 9]`. Two divergent behaviors are reasonable:
1. Silent deduplication (treat as `[7, 9]`, silently splitting between 2 members instead of 3).
2. Rejection with HTTP 400.

Silent deduplication changes the split count and therefore all share amounts without informing the caller. The PK constraint on `ExpenseSplit(expense_id, member_id)` would also cause a hard database error on insert attempt if not caught first.

**Proposed resolution:** Duplicate member IDs in `split_between` must be rejected with HTTP 400 and the message: `"split_between contains duplicate member IDs."` Validation must occur before any database write.

---

### Issue 4 — Whitespace-only group names not explicitly rejected

**Section:** §4.2 (Create a Group), §3.1 (Group entity)

**Problem:** §4.2 states: *"If the group name is blank, the request is rejected with a 400 error."* For member names, the spec explicitly adds: *"Whitespace-only member names are rejected with a 400 error."* The group name section omits this clause. A name consisting solely of spaces (e.g., `"   "`) is technically non-empty as a string, so "blank" is ambiguous. An implementer may accept `"   "` as a valid group name or reject it, depending on their interpretation.

**Proposed resolution:** Group name validation must mirror member name validation: after trimming leading/trailing whitespace, the name must be non-empty. A whitespace-only group name is rejected with HTTP 400 and the message: `"Group name must not be blank."` The stored name is the *untrimmed* original (preserving the user's input); only the emptiness check uses the trimmed form. (Alternatively, trim before storing — but the spec must pick one; this addendum chooses preserve-original to be consistent with not silently mutating user input.)

---

### Issue 5 — Sort order of `members` and `expenses` arrays in API responses is unspecified

**Section:** §5.3 (`GET /api/groups/:id` response), §5.2 (`POST /api/groups` response)

**Problem:** The spec describes the shape of the `members` and `expenses` arrays but never states their sort order. For `members`, two reasonable orderings are insertion order (ascending `id`) or alphabetical by name. For `expenses`, §4.3 specifies the HTML view should be "most recent first," but §5.3 does not carry this ordering requirement over to the JSON response. An implementer building the HTML from the API response must know whether the API returns expenses newest-first or whether the HTML layer must sort them.

**Proposed resolution:**
- The `members` array in all API responses must be ordered by `id` ascending.
- The `expenses` array in `GET /api/groups/:id` must be ordered by `created_at` descending (most recent first), consistent with §4.3. The HTML layer may rely on this ordering and must not sort independently.

---

### Issue 6 — Dollar-to-cents conversion using float multiplication is fragile

**Section:** §7.5 (Dollar-to-Cents Conversion)

**Problem:** The spec prescribes: *"the server converts to cents by parsing as a float, multiplying by 100, and rounding to the nearest integer."* For inputs with at most 2 decimal places, IEEE 754 double-precision arithmetic is reliable in practice (e.g., `parseFloat("0.01") * 100 = 1.0000000000000002` rounds to 1 ✓). However, the spec-mandated method is not guaranteed to be safe for all valid 2-decimal-place inputs across all JavaScript engines and edge cases (e.g., very large amounts near the $999,999.99 limit). The method also makes the >2-decimal-places check tricky to implement correctly via float comparison.

**Proposed resolution:** Replace the float-based prescription with string-based parsing: split the input string on `.`; if no decimal point, cents = integer part × 100; if one decimal point, validate that the fractional part has 1 or 2 digits (reject otherwise with `"Amount must have at most 2 decimal places."`), then compute `cents = integer_part * 100 + fractional_part * (fractional_digits == 1 ? 10 : 1)`. This is exact, requires no floating-point arithmetic, and makes the decimal-place validation trivial. The max-amount and positivity checks are applied after the integer cent value is computed.

---

### Issue 7 — JSON balance format for positive and zero values not explicitly stated

**Section:** §5.3 (`GET /api/groups/:id`)

**Problem:** The example shows negative balance as `"-7.34"` (with `-` prefix) and positive balance as `"14.67"` (no `+` prefix). The `$0.00` format is shown in §4.3 for the HTML layer but the corresponding JSON format for a zero balance is never given. An implementer might return `"0.00"`, `"-0.00"`, or `"0"`. Additionally, the format spec doesn't state whether balances always include exactly 2 decimal places (e.g., `"7.30"` vs `"7.3"`).

**Proposed resolution:** Balance strings in the JSON API must always include exactly 2 decimal places. Positive balances have no sign prefix (e.g., `"14.66"`). Negative balances use a `-` prefix (e.g., `"-7.33"`). A zero balance is `"0.00"` (not `"-0.00"`). The HTML layer adds the `+` prefix and `$` currency symbol for display; the API layer never does.

---

## 2. Items Checked and Found Solid

- **Member name uniqueness (§3.2, §4.2):** Both the entity constraint and the creation-time validation rule are clearly specified, including case-insensitive comparison and the 400 rejection behavior.
- **Payer not required to be in split (§4.4):** Explicitly stated. No ambiguity.
- **Last-expense deletion (§4.5, §7.2, §7.3):** The combination of §7.2 (group with zero expenses gives all-zero balances) and the §6 formula (computed at query time from raw data) fully covers the "delete last expense" scenario. No special case needed.
- **HTTP status codes:** 200/201/400/404 are assigned correctly across all endpoints. DELETE returning 200 with a body (§5.5) is intentional and consistent.
- **Rounding rule (§7.1):** Deterministic, unambiguous, with a worked example that verifies the sum. Two independent implementers would produce identical `share_amount` values (the balance example in §5.3 being wrong does not affect the rule itself).
- **Empty `split_between` rejection (§7.4, §4.4):** Clearly specified with an exact error message.
- **Amount validation (§7.5):** Covers all rejection cases (non-parseable, ≤ 0, > 2 decimal places, > $999,999.99) with specific messages.
- **Member cross-group reference (§4.4, §5.4):** Validation that `paid_by` and all `split_between` members must belong to the group being charged is specified.

---

## 3. Resolved Spec Addendum

This addendum is authoritative alongside `docs/step1-specify.md`. Where they conflict, this addendum takes precedence.

**A1 (fixes Issue 1) — Correct balance values in the §5.3 worked example:**
The canonical correct balances for the $22.00 / 3-member example are:
- Alice (id 7): `"14.66"` (paid 2200 cents, owed 734 cents → 1466 cents)
- Bob (id 8): `"-7.33"` (paid 0, owed 733 cents → −733 cents)
- Carol (id 9): `"-7.33"` (paid 0, owed 733 cents → −733 cents)

Implementers must use the §6 formula and §7.1 rounding rule as the authoritative source; the §5.3 example values are illustrative and were erroneous.

**A2 (fixes Issue 2) — Balance sum invariant is exact zero:**
The sum of all member balances in a group is exactly zero. No ±1 cent tolerance applies. The §7.1 rounding rule guarantees `SUM(share_amounts per expense) = expense.amount` exactly, which in turn guarantees balance sum = 0.

**A3 (fixes Issue 3) — Duplicate IDs in `split_between` are a 400 error:**
If `split_between` contains any repeated member ID, the request is rejected before any DB write with HTTP 400 and the message: `"split_between contains duplicate member IDs."`

**A4 (fixes Issue 4) — Whitespace-only group names are rejected:**
Group name validation: trim leading/trailing whitespace; if the result is empty, reject with HTTP 400 and the message: `"Group name must not be blank."` The name is stored as provided (untrimmed). This matches the behavior for member names.

**A5 (fixes Issue 5) — Array ordering in API responses:**
- `members` arrays in all API responses: ordered by `id` ascending.
- `expenses` array in `GET /api/groups/:id`: ordered by `created_at` descending (newest first). The HTML page may rely on this order without re-sorting.

**A6 (fixes Issue 6) — String-based dollar-to-cents conversion:**
Implement dollar-to-cents conversion by splitting the input string on `.` (after confirming it is a valid non-negative numeric string):
1. If no `.`: `cents = parseInt(integerPart, 10) * 100`.
2. If one `.` with 1 fractional digit: `cents = parseInt(integerPart, 10) * 100 + parseInt(fracPart, 10) * 10`.
3. If one `.` with 2 fractional digits: `cents = parseInt(integerPart, 10) * 100 + parseInt(fracPart, 10)`.
4. If one `.` with 3+ fractional digits: reject with HTTP 400 `"Amount must have at most 2 decimal places."`.
5. If more than one `.` or non-digit characters (other than a leading `-`, which should be rejected separately): reject with HTTP 400 `"Invalid amount."`.
No floating-point arithmetic is used in this conversion path.

**A7 (fixes Issue 7) — JSON balance string format:**
Balance strings in all API responses:
- Always include exactly 2 decimal places (e.g., `"7.30"` not `"7.3"`).
- Negative: leading `-` (e.g., `"-7.33"`).
- Positive: no sign prefix (e.g., `"14.66"`).
- Zero: `"0.00"` (never `"-0.00"`).
The HTML rendering layer adds `+` for positives and the `$` symbol; the JSON API never includes these.

---

## 4. Definition of Done — Review Stage

- [x] `docs/step1-review.md` exists in the repository.
- [x] Every issue is cross-referenced to a specific section of `docs/step1-specify.md`.
- [x] Each issue includes a concrete, implementer-actionable resolution (no open-ended "TBD" resolutions).
- [x] The balance example inconsistency (Issue 1) is identified and the correct values are stated.
- [x] The rounding/float-point concern (Issues 2, 6) is addressed with explicit implementation guidance.
- [x] Member-uniqueness behavior and payer-not-in-split are verified as correctly specified (no new issues).
- [x] Last-expense deletion behavior is verified as covered by existing spec sections.
- [x] All HTTP status codes across all five API endpoints are verified as assigned.
- [x] Entity table constraints (§3) are verified against the JSON examples (§5); the one inconsistency (balance values) is documented in Issue 1 / A1.
- [x] The addendum in §3 leaves no implementer question open-ended: every rule is a crisp, deterministic statement.
- [x] No application code has been written or modified as part of this review stage.
