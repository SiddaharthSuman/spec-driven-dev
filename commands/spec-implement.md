---
description: Implement a Feature Spec end to end, under this project's workflow rules.
---

Read `docs/context/06-progress-tracker.md` first and confirm the spec at
$ARGUMENTS isn't already "Completed."

Read the full spec at $ARGUMENTS.

It doesn't matter whether the spec came from `/spec-new`'s brainstorm-then-draft
flow or was hand-written. Either way, by this point it should already conform
to `_template.md`.

If the spec carries an `Amends` field, it follows `_amendment-template.md`
instead. Treat the spec it amends as read-only and never edit it. Make sure you
understand exactly what's being Added, Modified and Removed before touching
code. Once this amendment reaches "Awaiting verification," note in the tracker
that the amended spec's own entry will need a one-line forward-pointer once this
amendment passes independent verification (the amendment rule in
`04-ai-workflow-rules.md`), but don't add that pointer until verification
actually passes.

Other installed toolsets are fair game if they help: Superpowers'
test-driven-development or requesting-code-review skills, frontend-design's
UI guidance, Context7 for library docs. None of them replace
`docs/context/06-progress-tracker.md` as the single source of truth for spec
status, so don't let a plugin's own internal state stand in for updating it.

Apply i-have-adhd's output rules (action-first, numbered steps, no
preamble/recap/tangents, cap lists at 5) to progress narration during
implementation. Never apply them to anything written to the tracker, the
spec file, or a living doc (`02-architecture.md`, `05-ui-context.md`, or
whichever doc `AGENTS.md` names). Those stay complete regardless of active
mode.

Commits made during implementation follow `AGENTS.md`: one short imperative
line, no body, no attribution trailer. Code and config files follow its
"Code text rules" (plain ASCII, no dashes, straight quotes). If the project has
`scripts/sanitize.mjs`, run it on the files you changed before committing.

Whenever the Dependencies section names a new or updated library, or you're
about to write a call whose exact signature you're inferring rather than
something you've just verified, check Context7 (`resolve-library-id` then
`query-docs`) before writing that code.

Mark the spec "In progress" in the tracker, dated today.

Implement exactly what's specified, no more. If you hit a decision the spec
doesn't cover, stop and ask rather than guessing.

Run the project's typecheck command (listed in `AGENTS.md`) once before you
start, to capture a baseline error count, and once more after implementation to
diff against that baseline. Don't run it repeatedly mid-implementation as a
substitute for reading the TypeScript errors your editor and tooling already
surface. Two full-project typechecks per spec is the target, not five or six.

If any Acceptance Criteria describe behavior unit and integration tests
genuinely can't reach (visual rendering, animation timing, drag interactions),
run a live-browser check before moving to "Awaiting verification." If the
project has a `playwright-live-verification` skill, use it. Skip this where
automated tests already cover everything. It's not a blanket requirement.

Before the tracker moves to "Awaiting verification," update whichever living
doc actually reflects this spec's changes. This step is mandatory, not a
follow-up: an architecture or cross-cutting change goes in
`docs/context/02-architecture.md`, a UI convention change in
`docs/context/05-ui-context.md`, and anything else in the doc `AGENTS.md`
names for that area. Bump that doc's "Last updated" date if it has one. The
tracker move and the living-doc update both count as part of "implementation
done," so don't do one without the other.

Any non-trivial tooling discovered along the way should already be captured
via `/run-skill-generator`, or explicitly noted as not worth capturing (the
tooling-capture rule in `04-ai-workflow-rules.md`). Handle this now, not as
something to remember later.

Once implementation is finished, move the tracker to "Awaiting verification."
Do not mark it "Completed" yourself. Say you're ready for verification and
stop there.
