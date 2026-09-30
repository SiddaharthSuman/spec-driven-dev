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
scoped requirement. Follow its Socratic style for the questions themselves:
one decision at a time, each with the options and a recommendation.

Stop brainstorming as soon as scope has converged. Do not recap the design in
chat and ask "does this look right so far?". Write the spec file next, and let
the person review the real document. The spec is the review artifact; a prose
summary of it is a second, weaker copy that adds a round trip.

Then draft the spec itself:

- Match `docs/specs/_template.md` section for section: Goal, Design Decisions,
  Implementation Details (API/UI/Data model), Dependencies, Acceptance
  Criteria written in EARS form, and a Verification Checklist. Also include
  the three sections below whenever they apply, even if the project's template
  predates them.
- If Dependencies names a new or updated library, resolve it through Context7
  (`resolve-library-id` then `query-docs`) before the spec states anything
  about that library's behavior.
- Write the spec in its own clean voice. Summarize the brainstorm's
  conclusions rather than pasting the discussion. Whoever reads this later
  (`/spec-implement`, `spec-verifier`) should see a requirements document, not
  a transcript.

**Deferred and out of scope.** Name everything the spec deliberately leaves
out and where it goes instead: "Deferred to: <later spec or idea>". If the
spec defers something a reader would expect (a sidebar on a dashboard spec),
also add it as a one-line entry in the progress tracker, so the gap reads as
planned scope and not as a defect.

**Affected existing files.** List every file, test, snapshot, generated
artifact and page that the change touches or breaks without being the subject
of the spec. A new cross-cutting element (layout shell, route wrapper, global
provider, token, shared component) changes code you are not writing. Find
these by search, not memory: grep for the consumers, list the pages that
render inside the new wrapper, list the tests and screenshot baselines that
will change, and check for duplicated elements such as a second `<h1>` or a
second landmark. "Unchanged" is a claim to verify, not to assume.

**UI detail (UI specs only).** Every text element gets a size, weight and
color token; every interactive element gets its states (default, hover,
active, focus, disabled); responsive behavior is stated per breakpoint. Where
the design tokens document a role, quote it. Where they do not, mark the
choice "(proposed)". If the spec points at reference images, walk each image
region by region (top bar, side panel, content, footer) and confirm every
region is either specified or listed under Deferred. A region that appears in
no section is a miss.

**Self-review before showing it.** Read the whole spec once end to end, then:
for every fact you changed while drafting (a token name, a count, a path),
grep the spec for other places that state the same fact and make them agree.
Check that each Acceptance Criterion has a named test and that each item in
Affected existing files has a line under Implementation Details.

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
