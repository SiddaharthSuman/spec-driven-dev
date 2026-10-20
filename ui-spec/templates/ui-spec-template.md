# <Screen name> layout spec

Template. Copy to `docs/design/specs/<screen>.spec.md`. The table itself is produced by the local tools, not typed.
Keep `<screen>.spec.json` next to it (same base name): the generated tests read the json.

## Header (fill in)

| Field | Value |
|---|---|
| Screen / route | `<screen>` at `/path` |
| Canvas | `<width> x <height>` CSS px (export scale `<n>`) |
| Measured | `<date>` by `<name>`, local model `<model and quantisation>`, tools `<setup script md5>` |
| Measurement check | `<mean error> px mean, <n> of <total> elements over tolerance` (from `inkcheck`) |
| Copy | `real` or `redacted (textmap kept in the private folder)` |
| Known gaps | `<elements the measurement missed or got wrong, one per line>` |

## Table

Paste the contents of `<screen>.spec.md` produced by `spec --image=...` here, or keep it as the file itself and
link it. Do not edit numbers by hand: re-measure, or amend through a spec.

## Acceptance criteria to paste into the feature spec (EARS)

```markdown
- WHEN `<route>` is rendered at `<width> x <height>` THE SYSTEM SHALL place every element listed in
  `docs/design/specs/<screen>.spec.md` within its `tol px` of the listed x, y, w and h.
- WHEN `<route>` is rendered THE SYSTEM SHALL show each listed text exactly as written in the table.
- WHEN `<route>` is rendered at `<width> x <height>` THE SYSTEM SHALL NOT scroll horizontally.
- WHERE a row has padding or gap values THE SYSTEM SHALL use those values within `tol px`.
- IF an element in the table has no `data-ui-id` match THEN the geometry test SHALL fail.
```

Test coverage: `tests/ui-spec/<screen>.spec.ts` (generated). The verifier confirms it exists, is current
(`node scripts/gen-ui-spec-tests.mjs --check`) and passes. It does not judge pixel closeness by eye.

## Assumptions and deviations

List here any place where the build deliberately differs from the table (for example, a hit area larger than the
visual box) and why. Anything bigger than the tolerance goes through an amendment spec.
