---
description: Turn a rough idea into a Feature Spec through a guided requirements
  discussion, then write it to the project's spec template. Stops before any
  implementation begins.
---

Treat $ARGUMENTS as a rough, possibly incomplete description of the feature or
change under consideration.

## 1. Check whether this is really new scope

Before brainstorming anything, search `docs/specs/` (including `archive/`) and
`docs/context/06-progress-tracker.md` for a spec already marked "Completed"
that covers the same feature area as $ARGUMENTS.

- **Found one?** Ask directly whether this is (a) an amendment to that
  completed spec, or (b) a distinct new capability that happens to touch the
  same area. Don't assume, because the two paths diverge immediately.
  - If (a): skip the brainstorm entirely. Draft against
    `docs/specs/_amendment-template.md`, with `Amends:` pointing at the
    completed spec's path (for a chain of amendments, always the original).
    Discuss only the actual delta (what is Added, Modified, Removed). A full
    requirements pass on something already shipped is wasted effort. Continue
    at step 3.
  - If (b), or if nothing completed covers this area: continue at step 2 as a
    normal new spec.

## 2. Brainstorm before drafting

Use Superpowers' brainstorming skill to work the rough idea into a concrete,
scoped requirement. Follow its Socratic style: walk through reasoning in
pieces the person can approve as you go, rather than presenting a finished
spec out of nowhere.

Once scope has genuinely converged, draft the spec itself:

- Match `docs/specs/_template.md` section for section: Goal, Design Decisions,
  Implementation Details (API/UI/Data model), Dependencies, Acceptance
  Criteria written in EARS form, and a Verification Checklist.
- If Dependencies names a new or updated library, resolve it through Context7
  (`resolve-library-id` then `query-docs`) before the spec states anything
  about that library's behavior.
- Write the spec in its own clean voice. Summarize the brainstorm's
  conclusions rather than pasting the discussion. Whoever reads this later
  (`/spec-implement`, `spec-verifier`) should see a requirements document, not
  a transcript.

## 3. Number and save

Specs live in a folder per developer, and numbers are per developer, never
global.

1. Read `git config user.name` and slugify it (lowercase, letters and digits,
   everything else becomes a single hyphen). If it is empty, stop and tell the
   person to run `git config user.name "<name>"`.
2. Find this developer's highest number across three places: files in
   `docs/specs/<developer>/`, files named `<developer>-<NNN>-...` in
   `docs/verification-log/`, and tracker entries tagged with the developer.
   Archived specs drop the folder, so the log and tracker are how their numbers
   are found. Use the next number, zero-padded to three digits.
3. Save to `docs/specs/<developer>/<NNN>-<short-kebab-name>.md`, creating the
   folder if needed. An amendment gets its own next number in the same folder.

## 4. Stop here

Show the finished spec and wait. Do not start `/spec-implement` or begin
writing code. This command's job ends at a spec ready for review.
