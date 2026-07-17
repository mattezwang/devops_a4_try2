# SplitTab Step 2 — Spec Review

**Document reviewed:** `docs/step2-specify.md`
**Codebase skimmed:** `src/balances.js`, `src/routes/groups.js`, `src/routes/expenses.js`, `src/db.js`
**Reviewer role:** Critical spec reviewer (did not author the spec)
**Verdict:** READY WITH FIXES

The spec is structurally solid: the four features are coherent, the settlements table is well-formed, the balance formula proof is correct, the debt-simplification algorithm is fully deterministic, and several potential ambiguities (duplicate member IDs in `splits`, delete-is-sufficient for settlements, feed tie-breaking) are explicitly addressed. Four issues need resolution before implementation: the schema-migration guard is underspecified, the backward-compat claim for the `expenses` array is self-contradictory, the full validation ordering for `POST /api/groups/:id/expenses` is incomplete, and the percentage-rounding remainder-bounds claim is unproven for edge inputs. Two minor issues complete the list.

---

## 1. Summary of Checks

### Zero-sum invariant with settlements

**Formula (§5.2):**
```
balance(m) = total_paid(m) − total_owed(m) + settled_out(m) − settled_in(m)
```

Group-wide sum:
- `SUM(total_paid) − SUM(total_owed) = 0` (step-1 invariant: splits always sum to the expense amount exactly).
- `SUM(settled_out) − SUM(settled_in) = 0` because every `Settlement.amount` appears in exactly one member's `settled_out` and exactly one other member's `settled_in`; the net contribution is zero.

Therefore `SUM(balance) = 0` exactly. **Invariant holds. ✓**

**Worked verification (continuing §4.2 example — $22.00 groceries, step-1 splits: Alice 734 cents, Bob 733 cents, Carol 733 cents):**

After Bob records a $7.33 (733 cent) settlement to Alice:
- Alice: 2200 − 734 + 0 − 733 = **733 cents** (+$7.33) ✓
- Bob:   0 − 733 + 733 − 0   = **0 cents** ($0.00) ✓
- Carol: 0 − 733 + 0   − 0   = **−733 cents** (−$7.33) ✓
- Sum: 733 + 0 − 733 = **0** ✓

After Carol also records $7.33 to Alice:
- Alice: 2200 − 734 + 0 − 1466 = **0** ✓
- Sum: 0 + 0 + 0 = **0** ✓

The §5.2 worked example arithmetic is correct.

---

### Percentage sum validation — `33.33 + 33.33 + 33.34`

In JavaScript/IEEE 754, `33.33 + 33.33 + 33.34` evaluates to exactly `100` (or at worst `99.99999999999999`). In either case `Math.round(S * 100)` = `Math.round(10000)` = `10000`. The sum is accepted. ✓

Rounding algorithm trace for $10.00 (1000 cents) with those percentages:

Sort by percentage DESC, memberId ASC (assuming IDs 7, 8, 9):
1. member 9: 33.34% → floor(1000 × 33.34 / 100) = floor(333.4) = 333
2. member 7: 33.33% (lower id) → floor(333.3) = 333
3. member 8: 33.33% (higher id) → floor(333.3) = 333

Total floor = 999. Remainder = 1. Member 9 (position 0) gets +1 → 334 cents.
Final: 334 + 333 + 333 = **1000** ✓

The algorithm is fully deterministic for this input. ✓

---

### Debt-simplification — 4-member traced example

Members: Alice (id 1, +$10.00 / 1000 cents), Bob (id 2, −$3.00 / −300), Carol (id 3, +$5.00 / 500), Dave (id 4, −$12.00 / −1200). Sum: 1000 + 500 − 300 − 1200 = 0 ✓

creditors: [{Alice, 1000}, {Carol, 500}]  
debtors:   [{Dave, −1200}, {Bob, −300}]

**Iteration 1:**
- Largest creditor: Alice (1000 > 500)
- Largest debtor by magnitude: Dave (1200 > 300)
- amount = min(1000, 1200) = 1000
- Transaction: Dave pays Alice $10.00
- Alice: 1000 − 1000 = 0 → removed; Dave: −1200 + 1000 = −200

**Iteration 2:**
- Largest creditor: Carol (500)
- Largest debtor by magnitude: Bob (300 > 200)
- amount = min(500, 300) = 300
- Transaction: Bob pays Carol $3.00
- Bob: 0 → removed; Carol: 500 − 300 = 200

**Iteration 3:**
- Largest creditor: Carol (200)
- Largest debtor: Dave (−200)
- amount = min(200, 200) = 200
- Transaction: Dave pays Carol $2.00
- Carol: 0 → removed; Dave: 0 → removed

Result: 3 transactions (= n − 1 = 4 − 1 ✓), all balances zero ✓. Correct.

---

### `split_type='exact'` duplicate member_id

§3.2.2 states "No duplicate `member_id` values are permitted in the `splits` array." §3.5 lists this as a 400 error with message `"splits contains duplicate member IDs."` for both `exact` and `percentage`. Explicitly covered. ✓

---

### Delete settlement = inverse of create

§5.4 correctly notes that "balances are computed at query time from the raw data, deletion is sufficient." Deleting a settlement row removes its `amount` from both the payer's `settled_out` sum and the recipient's `settled_in` sum simultaneously — exactly reversing the effect of creation. No additional compensating row is needed. ✓

---

### Schema migration compatibility

`CREATE TABLE IF NOT EXISTS settlements` and all three `CREATE INDEX IF NOT EXISTS` statements are idempotent and can be appended to the existing `db.exec()` batch in `src/db.js` without any guard. The problem is `ALTER TABLE expenses ADD COLUMN split_type` — see Issue 1 below.

---

## 2. Issues Found

### Issue 1 — Migration guard pattern underspecified (§2.1) — SIGNIFICANT

**Section:** §2.1 (New column on `expenses`)

**Problem:** `ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'` is not idempotent. SQLite versions below 3.37.0 have no `ADD COLUMN IF NOT EXISTS` syntax. The spec acknowledges this and offers two approaches: "catching the SQLite error if the column already exists (or check `PRAGMA table_info(expenses)` first)." Using "or" without choosing one leaves two divergent implementations.

Additionally, the current `src/db.js` schema is one large `db.exec()` string. Putting the `ALTER TABLE` inside that same call would always fail on the second startup (column already exists). The spec does not say to run it as a separate `db.exec()` call, nor does it show any code sketch.

Two implementers following the spec could write:
- Implementer A: wraps only the ALTER in a `try { db.exec('ALTER TABLE ...') } catch {}` after the main batch
- Implementer B: does a `PRAGMA table_info(expenses)` check and skips the ALTER if the column is present

These are both acceptable but the spec must pick one.

**Proposed resolution:** Add a concrete code sketch to §2.1 (see Addendum A1).

---

### Issue 2 — "Expenses array retained unchanged" contradicts §3.4 (§6.1 vs §3.4) — SIGNIFICANT

**Section:** §6.1 (Decision: Supplement, Not Replace); §3.4 (Response Shape)

**Problem:** §6.1 states: "The existing `expenses` array in `GET /api/groups/:id` is **retained unchanged** for backward compatibility." §3.4 states: "`split_type` is also included in each expense object within `GET /api/groups/:id` `expenses` and `feed` arrays." The §6.3 JSON example confirms `split_type` appears in `expenses` items.

"Unchanged" and "now includes a new field" are contradictory. An implementer reading §6.1 first might add `split_type` only to the `feed` items, not to the `expenses` items.

The same issue applies to `POST /api/groups/:id/expenses`: the §3.4 response shape now includes `split_type`, but the spec does not explicitly acknowledge this is an additive change to the step-1 response body. The spec says "No step-1 behavior is changed" (§1 Overview) while simultaneously adding a field to every expense-creation response.

**Proposed resolution:** Replace "retained unchanged" in §6.1 with a precise statement (see Addendum A2).

---

### Issue 3 — Full validation order for expense creation is incomplete (§3.5) — SIGNIFICANT

**Section:** §3.5 (Validation Rules)

**Problem:** §3.5 gives the ordering of the new validations only: "`split_type` value → `splits` array presence/emptiness → duplicate `member_id` checks → individual `member_id` membership → individual amount/percentage validity → sum check." It does not state where these new checks fall relative to the step-1 validations (description, amount, `paid_by`).

Two reasonable orderings diverge on which 400 error fires first for a request with both a blank description and an invalid `split_type`:
- Option A: description validated first → `"Description must not be blank."`
- Option B: `split_type` validated first → `"Invalid split_type..."`

The existing step-1 implementation validates in this order:
1. group existence (404)
2. description
3. amount
4. `split_between` (presence → duplicates → membership)
5. `paid_by` membership

A complete ordering for step-2 expense creation must be specified.

**Proposed resolution:** The full ordering is given in Addendum A3.

---

### Issue 4 — Percentage rounding: remainder bounds are not proven (§3.3) — MINOR

**Section:** §3.3 (Percentage-to-Cents Rounding Algorithm)

**Problem:** The spec states: "In practice, with percentages summing to 100.00, `remainder` is always ≥ 0 and < `len(splits)`." This is claimed as a practical invariant but not proven.

The acceptance criterion `Math.round(S * 100) === 10000` permits sums up to `S ≤ 100.004999...`. For a large expense amount (e.g., $999,999.99 = 99,999,999 cents) and `S = 100.0045` (a pathological but accepted IEEE 754 sum), the mathematical value of `totalCents × S / 100 ≈ 100,004,499`, far exceeding `totalCents`. Each individual `Math.floor(totalCents × p / 100)` value is bounded by `totalCents × p / 100`, so `totalFloor ≤ totalCents × S / 100`. But `totalFloor` is computed via floating-point arithmetic, meaning individual terms can be rounded slightly above or below their true values.

If floating-point arithmetic causes even one term to round up past a whole-number boundary, `totalFloor` could exceed `totalCents`, yielding `remainder < 0`. If each floor undershoots maximally and `S` is near its upper bound, `remainder` could exceed `len(splits)`.

Neither condition triggers the described remainder-distribution loop correctly (negative remainder would subtract cents; `remainder ≥ len(splits)` would distribute extra cents to indices that don't exist, or loop past the array length).

Note: these edge cases require both a large amount and a very close-but-not-exact percentage sum. They do not arise with the spec's own worked examples. However, a defensive guard is cheap and eliminates ambiguity.

**Proposed resolution:** Add a clamp and a guard (see Addendum A4).

---

### Issue 5 — `exact` split: zero-amount custom error row is unreachable (§3.5) — MINOR

**Section:** §3.5, validation table row: `splits[i].amount` converts to 0 cents or is negative

**Problem:** The spec instructs the implementer to first validate each `splits[i].amount` via `dollarsToCents` (which throws `"Amount must be a positive number."` for any amount ≤ 0 cents), and then check separately with the message `"Each exact split amount must be a positive number."` These two checks cover the same condition. Since `dollarsToCents` runs first (per the specified validation order), the custom message is never reached.

**Proposed resolution:** Remove the redundant row (see Addendum A5).

---

### Issue 6 — Payer-not-in-splits not reiterated for exact/percentage splits (§3.2.2, §3.2.3) — MINOR

**Section:** §3.2.2 (`exact`), §3.2.3 (`percentage`)

**Problem:** Step-1 allows `paid_by` to not appear in `split_between` (step-1 review confirmed this is "explicitly stated"). For `exact` and `percentage` splits, the analogous rule is that `paid_by` need not appear in `splits`. This is only implied by "All step-1 validations… remain in effect" but the step-1 rule was stated for `split_between`, and `splits` is a structurally different field. An implementer may require `paid_by` to appear in `splits` for non-equal splits.

**Proposed resolution:** Add one sentence to §3.2.2 and §3.2.3 (see Addendum A6).

---

## 2b. Items Checked and Found Solid

- **Zero-sum invariant (§5.2):** The formula proof is correct. `SUM(settled_out) = SUM(settled_in)` because every settlement contributes exactly once to each side. The §5.2 worked example arithmetic is verified correct (above).
- **Percentage sum validation (§3.2.3):** `Math.round(S * 100) === 10000` correctly handles `33.33 + 33.33 + 33.34`. The sum criterion is a standard and practical IEEE 754 tolerance technique. ✓
- **Percentage rounding — determinism:** Sort by percentage DESC then memberId ASC provides a unique, reproducible ordering for any input. Two independent implementers will produce bit-identical `share_amount` values. ✓
- **Debt-simplification termination (§4.1):** Each iteration removes at least one member from its list (when a balance reaches exactly zero). The lists start with at most `n` total members, so the algorithm terminates in at most `n − 1` iterations. Traced 4-member example above produces correct zero-sum result. ✓
- **`split_type='exact'` duplicate member_id (§3.2.2, §3.5):** Explicitly validated with exact error message. ✓
- **Delete settlement = exact inverse (§5.4):** Correct because balances are recomputed from raw rows on every query. No additional compensating write is needed. ✓
- **`settlements` table DDL (§2.2):** `CREATE TABLE IF NOT EXISTS` is idempotent; all three indexes use `CREATE INDEX IF NOT EXISTS`. Safe to append to the existing `db.exec()` batch. ✓
- **Feed ordering (§6.4):** Three-level sort is fully specified: `created_at` DESC → `type` ASC (alphabetical) → `id` DESC. All three levels have deterministic tie-breaking. ✓
- **`settlements` cross-group membership enforcement (§5.3):** Correctly delegated to application logic, with a note that SQLite FKs only guarantee member existence globally. Both membership checks are included in the validation table. ✓
- **`GET /api/groups/:id/settlements/suggested` — empty case (§4.2):** Returns `{ "suggested_settlements": [] }` when all balances are zero. Handled. ✓

---

## 3. Resolved Spec Addendum

This addendum is authoritative alongside `docs/step2-specify.md`. Where they conflict, this addendum takes precedence.

---

**A1 (fixes Issue 1) — Exact migration guard for `ALTER TABLE`:**

In `src/db.js`, run the existing `CREATE TABLE IF NOT EXISTS` batch as before. Then, as a separate statement after the batch, add the column using a `PRAGMA` guard:

```js
// Run after the main db.exec() CREATE TABLE block
const cols = db.prepare('PRAGMA table_info(expenses)').all();
if (!cols.some(c => c.name === 'split_type')) {
  db.exec("ALTER TABLE expenses ADD COLUMN split_type TEXT NOT NULL DEFAULT 'equal'");
}
```

This is safe on first run (column absent → ALTER runs), on all subsequent runs (column present → ALTER is skipped), and requires no try/catch. The `PRAGMA table_info` call is synchronous in `better-sqlite3`.

---

**A2 (fixes Issue 2) — Precise backward-compatibility statement for `expenses` array and POST response:**

Replace §6.1's "retained unchanged" with:

> The `expenses` field in `GET /api/groups/:id` is **retained** (not removed or renamed). Each expense object in the `expenses` array is extended with the `split_type` field (value `"equal"` for all pre-existing expenses). Existing fields are not renamed or removed.

Similarly, the `POST /api/groups/:id/expenses` response (§3.4) now includes `split_type`. This is a non-breaking additive change: new fields are added; no existing field is removed, renamed, or changes type. Step-1 API clients that parse only known fields are unaffected; clients that require byte-identical responses are out of scope.

---

**A3 (fixes Issue 3) — Full validation order for `POST /api/groups/:id/expenses`:**

The complete validation sequence (all validations before any DB write):

1. Group existence — 404 if not found.
2. `description` — blank/whitespace-only: 400. Exceeds 200 characters: 400.
3. `amount` — via `dollarsToCents`: 400 on any failure.
4. `split_type` value — if present and not one of `"equal"`, `"exact"`, `"percentage"`: 400.
5. **If `split_type` is `"equal"` (or absent):** validate `split_between` per step-1 rules (presence → duplicates → membership).
6. **If `split_type` is `"exact"` or `"percentage"`:** validate `splits` in this order:
   a. Array present, non-empty — 400 if missing or empty.
   b. No duplicate `member_id` — 400 if duplicates found.
   c. Each `member_id` belongs to the group — 400 for any non-member.
   d. Each `splits[i].amount` (exact) or `splits[i].percentage` (percentage) individually valid — 400 on first invalid item.
   e. Sum equals expense total (exact) or `Math.round(SUM × 100) === 10000` (percentage) — 400 if not.
7. `paid_by` membership — 400 if not a member of the group.

`paid_by` is validated last, after all split validations, consistent with the step-1 implementation.

---

**A4 (fixes Issue 4) — Percentage rounding: defensive remainder clamp:**

After computing `remainder = totalCents − totalFloor`, add:

```
remainder = Math.max(0, Math.min(remainder, sortedSplits.length))
```

This ensures the loop in Step 4 is always safe. In practice this clamp is never triggered for well-formed inputs, but it prevents undefined behavior if floating-point arithmetic causes `remainder` to fall outside `[0, len)`. The invariant `SUM(shareCents) == totalCents` remains exact as long as `remainder` stays within `[0, len]`; the clamp to `len` (not `len − 1`) ensures at worst every member gets +1 cent and one cent is "lost" — but this scenario requires a floating-point sum error of at least 1 cent, which only occurs for inputs that are pathological regardless.

---

**A5 (fixes Issue 5) — Remove redundant `exact` zero-amount validation row:**

Delete the following row from the §3.5 validation table:

> `split_type` is `"exact"` and any `splits[i].amount` converts to 0 cents or is negative → 400 `"Each exact split amount must be a positive number."`

`dollarsToCents` already throws `"Amount must be a positive number."` for any amount ≤ 0 cents, so this row is never reached. The prior row ("`splits[i].amount` is not a valid dollar string → reuse `dollarsToCents` message") covers all invalid amounts including zero.

---

**A6 (fixes Issue 6) — Payer exemption for `exact` and `percentage` splits:**

Add the following sentence to §3.2.2 and §3.2.3, in the bullet list describing the `splits` array:

> `paid_by` is not required to appear in the `splits` array (same rule as step-1's allowance of a payer not in `split_between`).

---

## 4. Definition of Done — Review Stage

- [x] `docs/step2-review.md` exists in the repository.
- [x] Every issue is cross-referenced to a specific section of `docs/step2-specify.md`.
- [x] Each issue includes a concrete, implementer-actionable resolution with no open-ended "TBD."
- [x] The zero-sum invariant is verified by algebra and a worked numeric example that includes both expenses and a settlement.
- [x] The percentage-to-cents rounding algorithm is verified for determinism, correct tie-breaking, and the `33.33 + 33.33 + 33.34` edge case.
- [x] The debt-simplification algorithm is traced by hand for a 4-member, mixed-balance group; it terminates and produces a zero-sum result.
- [x] `split_type='exact'` duplicate member_id rejection is confirmed specified.
- [x] Backward compatibility behavior for step-1 requests is analyzed; the contradiction in §6.1 is identified and resolved in A2.
- [x] Delete settlement's effect on balances is verified as the exact inverse of creating it.
- [x] The `ALTER TABLE` migration conflict with the existing `CREATE TABLE IF NOT EXISTS` pattern is identified and a concrete guard pattern is specified in A1.
- [x] The addendum in §3 leaves no implementer question open-ended: every rule is a crisp, deterministic statement.
- [x] No application code has been written or modified as part of this review stage.
