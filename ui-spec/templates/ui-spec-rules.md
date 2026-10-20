## UI layout specs

Continue the numbering from the last rule above.

24. **A layout table is part of the spec that cites it.** Authority order stays spec > 02-architecture.md > other
    context docs > existing code > generated docs. Inside that, for geometry the table outranks the screenshots
    in `docs/design/reference/` (direction only) and the agent's own judgment.
25. **Numbers outrank words.** x, y, w, h, padding and gap are binding within `tol px`. `layout` strings and
    inferred groups are hints and never justify moving an element away from its numbers.
26. **Geometry tests are generated, never hand-written or weakened.** `node scripts/gen-ui-spec-tests.mjs`
    writes `tests/ui-spec/<screen>.spec.ts` from the `.spec.json`. Rule 4 applies in full. `--check` runs in the
    full gate so a changed table cannot leave stale tests behind.
27. **Design assets never enter the repo or a session.** Screenshots, Figma exports, overlays and the model's raw
    item files stay in the private folder described in `ui-spec-local-boundary.md`. Only the typed table
    (redacted if the copy is sensitive) is committed or shown to an agent.
