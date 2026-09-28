## PR #812 review — Request changes (confidence 4/5, risk 2/3)

Adds invoice filtering but the new date-range validator allows an end date before the start date.

### Verification
- [ ] No blocking finding
- [x] Typecheck / lint / tests pass
- [x] Small, single-purpose diff
- [x] Reuses existing patterns
- [x] No open user-visible inconsistency

### Lenses
- **correctness**: Fail — The date-range validator does not check that end >= start.
- **security**: Pass — No new auth or data-access surface introduced.
- **simplicity**: Pass — Single-purpose diff, no unrelated refactors.
- **accessibility**: Note — New filter inputs have labels but no aria-describedby for the validation error.
- **consistency**: Pass — Follows the existing filter-panel pattern from the runbook feature.

### Findings (2, 1 blocking)
- **B1** (Blocking): Date-range filter accepts an end date before the start date.
  validateDateRange only checks both fields are present, never their order.
  `src/features/invoices/filters.ts:42`
- **N1** (Low): Filter panel's clear button has no accessible label.
  `src/features/invoices/FilterPanel.tsx:88`

### Visual coverage — 50% changed/new
- **invoice-list-filter-panel-open**: Changed
- **sweep-invoices**: Unchanged

### Spec
Linked: `docs/specs/012-invoice-filtering.md`

### Not independently verified
- Whether the backend actually rejects an invalid date range server-side was not checked — this PR only covers the client-side filter UI.

---
_base `11111111` · head `22222222` · not posted automatically — paste this yourself._