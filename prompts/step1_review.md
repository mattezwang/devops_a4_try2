You are working in the current git repository. This is stage "review" of
step 1 (base system) of SplitTab, a shared group-expense tracker.

A specification already exists at `docs/step1-specify.md`. Read it in full.
Act as a critical spec reviewer (a "plan reviewer" role) — someone whose job
is to find ambiguity, missing edge cases, internal inconsistencies, and
feasibility problems BEFORE anyone writes code. You did not write the spec,
so review it skeptically.

Your ONLY job in this stage is to write a review document. Do NOT write any
application code, do NOT modify `docs/step1-specify.md` itself.

Create `docs/step1-review.md` with:

1. A short summary of what you reviewed and your overall verdict (ready to
   implement / ready with fixes / not ready).
2. A numbered list of every issue you find, each with:
   - The section of `docs/step1-specify.md` it concerns.
   - What's wrong, ambiguous, or missing (be specific — quote or paraphrase
     the problematic text).
   - A concrete proposed resolution.
   Look especially hard for: rounding/floating-point issues in the balance
   math, what happens to balances/UI when the last expense in a group is
   deleted, whether member names need to be unique and what happens on
   duplicates, whether a member can be selected as payer without being in
   the split, missing HTTP status codes for any listed endpoint, and any
   contradiction between the entity tables in section 3 and the JSON
   examples in section 5.
   If, after careful reading, you find the spec is genuinely solid on a
   topic, it is fine to say so explicitly rather than inventing an issue —
   but check hard before concluding that.
3. A final "Resolved spec addendum" section: for every issue you raised,
   state the resolution as a crisp, implementable rule (this addendum is
   what the implementer will treat as authoritative alongside the original
   spec — so it must not leave anything open-ended).
4. A "Definition of done" checklist for this review stage.

Be thorough but do not pad the document with issues that don't matter; a
implementer should be able to build the entire base system from
`docs/step1-specify.md` + `docs/step1-review.md` together with zero further
questions.

When you are done writing `docs/step1-review.md`, stop. Do not commit or
push. Print the text REVIEW_WRITTEN as the last line of your output once the
file exists and looks complete.
