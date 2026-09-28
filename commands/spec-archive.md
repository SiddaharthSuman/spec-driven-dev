---
description:
  Close out a spec that has just passed independent verification — update its
  living doc, move the spec file into the archive, and repoint the tracker.
  Run only after spec-verifier (or a human reviewer) returns a PASS, never
  before.
---

Treat $ARGUMENTS as the path to a not-yet-archived spec under `docs/specs/`.

First confirm `docs/context/06-progress-tracker.md` shows this spec as
"Awaiting verification" with an independent PASS already on record (per Rule
4, `04-ai-workflow-rules.md`) — either from `spec-verifier` or a human
reviewer's sign-off. If there's no recorded PASS yet, stop here: this command
finalizes a verification result, it doesn't produce one.

Then perform all three of the following as a single unit — never leave a
spec half-archived (say, the living doc updated but the file not yet moved)
at a point where someone could interrupt you:

1. **Update the living doc.** Whichever doc owns this spec's changes — the
   matching `docs/audit-notes/feature-*.md` for a single-feature spec, or
   `02-architecture.md`/`05-ui-context.md` for something cross-cutting, same
   as `spec-implement.md` uses before verification. Confirm it's actually
   accurate against what shipped (fix it now if the verifier flagged
   staleness), and bump its "Last updated" date.
2. **Move the file.** `docs/specs/<filename>.md` →
   `docs/specs/archive/<YYYY-MM-DD>-<filename>.md`, dated today. Create
   `docs/specs/archive/` if it doesn't exist. If the spec carries sprint
   metadata, keep it as a header tag inside the file (e.g.
   `Sprint: 2026-Q3-Sprint4`) — never create a sprint-named subfolder inside
   the archive.
3. **Update the tracker.** Move this spec's entry to "Completed" and repoint
   its link from the old `docs/specs/<filename>.md` path to the new
   `docs/specs/archive/<YYYY-MM-DD>-<filename>.md` path.

If this spec has an `Amends` field, Rule 9's forward-pointer step still
applies on the original spec's entry as usual — archiving an amendment never
moves the original spec's own file.
