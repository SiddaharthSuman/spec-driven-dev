---
description:
  Close out a spec that has just passed independent verification. Updates the
  living doc, archives the spec, condenses the tracker entry, writes the
  verification log, prints a manual verification script, and makes two local
  commits. Run only after spec-verifier (or a human reviewer) returns a PASS,
  never before.
---

Treat $ARGUMENTS as the path to a not-yet-archived spec under
`docs/specs/<developer>/`.

First confirm `docs/context/06-progress-tracker.md` shows this spec as
"Awaiting verification" with an independent PASS already on record, from
`spec-verifier` or a human reviewer's sign-off (the independent-check rule in
`04-ai-workflow-rules.md`). If there is no recorded PASS, stop here. This
command finalizes a verification result, it does not produce one.

Then do steps 1 to 5 as a single unit. Never leave a spec half-archived, say
with the living doc updated but the file not yet moved, at a point where
someone could interrupt you.

1. **Update the living doc.** The context doc that owns this spec's changes:
   `02-architecture.md` for architecture, `05-ui-context.md` for UI
   conventions, or whichever other doc `AGENTS.md` names for this area. Check
   it is accurate against what shipped (fix it now if the verifier flagged
   staleness), and bump its "Last updated" date if it carries one.
2. **Move the spec file.** `docs/specs/<developer>/<NNN-name>.md` to
   `docs/specs/archive/<YYYY-MM-DD>-<NNN-name>.md`, dated today. Create
   `docs/specs/archive/` if it does not exist. If the spec carries sprint
   metadata, keep it as a header tag inside the file (for example
   `Sprint: 2026-Q3-Sprint4`). Never create a sprint-named subfolder.
3. **Write the verification log.** Create
   `docs/verification-log/<developer>-<NNN>-<name>.md` (create the folder if
   needed) holding the full narrative: the verifier's PASS or FAIL per
   checklist item, any fix rounds and who verified each, what was skipped or
   left unverified and why, and any decisions made along the way. If this spec
   ran through `/engineer`, link its `*.run-stats.md` file from here.
4. **Condense the tracker entry.** Move the spec to "Completed" as one or two
   lines: title, developer, date, a link to the archived spec, and a link to the
   verification log. Nothing else. The detail now lives in the log.
5. **Amendments.** If the spec has an `Amends` field, add the one-line
   forward-pointer on the ORIGINAL spec's tracker entry (never on an
   intermediate amendment), if `spec-verifier` has not already. Archiving an
   amendment never moves the original spec's file.

## 6. Print the manual verification script

Translate the spec's Acceptance Criteria from EARS notation into concrete,
click-by-click actions a human can walk through in the running app before
pushing, numbered, each ending in what to expect. Criteria that are not
UI-observable (a validation rule, a header) get the same treatment with
whatever tool fits (curl, an API client, the network tab). Never skip one
because there is nothing to click. Shape it so it can be pasted straight into
a PR description's "how was this tested" section.

## 7. Make two local commits. Never push.

Split the working tree into two commits, docs first:

1. **Docs commit:** everything under `docs/` (the archived spec, the tracker,
   the verification log, the living doc, any run statistics).
2. **Code commit:** everything else, the actual application code.

A file that does not sort cleanly into either bucket, or unrelated changes
already in the tree, is a stop-and-ask case, not a guess. Before the code
commit, run `node scripts/sanitize.mjs --check` on the changed code files if
the project has that script.

Each commit message is one short imperative line with no body, for example
`Archive spec 001 dashboard audit list` and `Add dashboard audit list`. Never
add `Co-Authored-By`, `Claude-Session`, or any other trailer.

Tell the human the script above is worth running before they push, and that
nothing has been pushed.
