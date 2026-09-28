---
description:
  Implement a Feature Spec end to end, under this project's workflow rules.
---

Read `docs/context/06-progress-tracker.md` first and confirm the spec at
$ARGUMENTS isn't already "Completed."

Read the full spec at $ARGUMENTS.

It doesn't matter whether the spec came from `/spec-new`'s brainstorm-then-draft
flow or was hand-written — either way, by this point it should already conform
to `_template.md`.

If the spec carries an `Amends` field, it follows `_amendment-template.md`
instead. Treat the spec it amends as read-only — never edit it. Make sure you
understand exactly what's being Added/Modified/Removed before touching code.
Once this amendment reaches "Awaiting verification," note in the tracker that
the amended spec's own entry will need a one-line forward-pointer once this
amendment passes independent verification (Rule 9) — but don't add that
pointer until verification actually passes.

Other installed toolsets are fair game if they help — Superpowers'
test-driven-development or requesting-code-review skills, frontend-design's
UI guidance, Context7 for library docs. None of them replace
`docs/context/06-progress-tracker.md` as the single source of truth for spec
status, though — don't let a plugin's own internal state stand in for updating
it.

Whenever the Dependencies section names a new or updated library, or you're
about to write a call whose exact signature you're inferring rather than
something you've just verified, check Context7 (`resolve-library-id` →
`query-docs`) before writing that code.

Mark the spec "In progress" in the tracker, dated today.

Implement exactly what's specified — no more. If you hit a decision the spec
doesn't cover, stop and ask rather than guessing.

Run `pnpm build-check` once before you start, to capture a baseline error
count, and once more after implementation to diff against that baseline.
Don't run it repeatedly mid-implementation as a substitute for reading the
TypeScript errors your editor/tooling already surfaces — two full-project
typechecks per spec is the target, not five or six.

If any Acceptance Criteria describe behavior unit/integration tests genuinely
can't reach — visual rendering, animation timing, drag interactions — run a
live-browser check via the playwright-live-verification skill before moving
to "Awaiting verification." Skip this where automated tests already cover
everything; it's not a blanket requirement.

Before the tracker moves to "Awaiting verification," update whichever living
doc actually reflects this spec's changes — this step is mandatory, not a
follow-up:

- Single-feature change → that feature's matching `docs/audit-notes/feature-*.md`.
- Cross-cutting architecture or UI convention change → `docs/context/02-architecture.md`
  and/or `docs/context/05-ui-context.md` instead.

Either way, bump that doc's "Last updated" date too. The tracker move and the
living-doc update both count as part of "implementation done" — don't do one
without the other.

Any non-trivial tooling discovered along the way should already be captured
via `/run-skill-generator`, or explicitly noted as not worth capturing (Rule
7, `04-ai-workflow-rules.md`) — handle this now, not as something to remember
later.

Once implementation is finished, move the tracker to "Awaiting verification."
Do not mark it "Completed" yourself — say you're ready for verification and
stop there.
