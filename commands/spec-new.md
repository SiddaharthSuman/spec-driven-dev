---
description:
  Turn a rough idea into a Feature Spec through a guided requirements
  discussion, then write it to the project's spec template. Stops before any
  implementation begins.
---

Treat $ARGUMENTS as a rough, possibly incomplete description of the feature or
change under consideration.

## 1. Check whether this is really new scope

Before brainstorming anything, search `docs/specs/` and
`docs/context/06-progress-tracker.md` for a spec already marked "Completed"
that covers the same feature area as $ARGUMENTS.

- **Found one?** Ask directly whether this is (a) an amendment to that
  completed spec, or (b) a distinct new capability that happens to touch the
  same area. Don't assume — the two paths diverge immediately from here.
  - If (a): skip the brainstorm entirely. Draft against
    `docs/specs/_amendment-template.md`, with `Amends:` pointing at the
    completed spec's path. Discuss only the actual delta (what's being
    Added/Modified/Removed) — a full requirements pass on something already
    shipped is wasted effort. Continue at step 3 below.
  - If (b), or if nothing completed covers this area: continue at step 2 as a
    normal new spec.

## 2. Brainstorm before drafting

Use Superpowers' brainstorming skill to work the rough idea into a concrete,
scoped requirement. Follow its Socratic style — walk through reasoning in
pieces the person can approve as you go, rather than presenting a finished
spec out of nowhere.

Once scope has genuinely converged, draft the spec itself:

- Match `docs/specs/_template.md` section for section: Goal, Design Decisions,
  Implementation Details (API/UI/Data model), Dependencies, Acceptance
  Criteria written in EARS form, and a Verification Checklist.
- If Dependencies names a new or updated library, resolve it through Context7
  (`resolve-library-id` → `query-docs`) before the spec states anything about
  that library's behavior.
- Write the spec in its own clean voice — summarize the brainstorm's
  conclusions rather than pasting the discussion itself. Whoever reads this
  later (`/spec-implement`, `spec-verifier`) should see a requirements
  document, not a transcript.

## 3. Number and save

Find the highest existing number under `docs/specs/` and use the next one.
Save to `docs/specs/0<next-number>-<short-kebab-name>.md`.

## 4. Stop here

Show the finished spec and wait. Do not start `/spec-implement` or begin
writing code — this command's job ends at a spec ready for review.
