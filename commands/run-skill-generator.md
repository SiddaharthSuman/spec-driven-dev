---
description:
  Capture a non-trivial build/launch tooling discovery (a setup step, a
  workaround, a version-pin quirk) as a new project-local skill under
  .claude/skills/, per the tooling-capture rule in 04-ai-workflow-rules.md.
  Scope is build/launch recipes specifically. Anything broader gets
  hand-authored instead.
---

Take $ARGUMENTS as a description of what was discovered: what you were trying
to build or launch, what didn't work as expected, what actually fixed it or
made it work, and roughly how long it took to figure out. If $ARGUMENTS is
thin, ask for whichever of those four pieces is missing before drafting
anything. A recipe someone else can't actually reproduce later is worse than
no captured skill at all.

## 1. Scope check: build/launch recipes only

This command's scope is narrow and deliberate: a concrete recipe for getting
something to build, install, launch, or run correctly. Examples are a
dependency version pin, a required environment variable, an install-order
quirk, a CLI flag that isn't obvious from `--help`, or a config workaround for
a tool/environment mismatch.

If what actually happened is broader than that (an architectural insight, a
coding pattern, a process or workflow lesson, anything that isn't "run this,
set this, pin this, and it works"), stop here. Say plainly that this falls
outside `/run-skill-generator`'s scope, per the tooling-capture rule, and
hand-author the skill directly instead: write its `SKILL.md` yourself, using an
existing skill (`.claude/skills/`, or the spec-driven-dev plugin's own
`skills/` if you can see it) as a shape to follow, then continue from step 2
below.

## 2. Check for an existing skill covering the same ground

Look in `.claude/skills/` for a skill whose scope already overlaps this
discovery.

- If this discovery is a refinement, correction, or additional edge case of
  what an existing skill already documents, update that skill in place rather
  than creating a near-duplicate. Append the new case, or correct what's now
  known to be wrong.
- If it's a genuinely separate recipe that just happens to share a topic (for
  example two different version-mismatch workarounds for two different tools),
  create a new skill, but say explicitly why it's kept separate rather than
  folded into the existing one.

## 3. Draft the skill

Name it for the specific recipe, not the general tool: a
`<kebab-case-slug>` like `playwright-chromium-version-pin`, not `playwright`.
Write `.claude/skills/<slug>/SKILL.md` with:

- YAML frontmatter: `name`, and a `description` written as a trigger for a
  future agent, meaning when to load this and not just what it's about. Match
  the style of this package's own skills (for example
  `subagent-dispatch/SKILL.md`).
- The recipe itself: the exact commands, versions, flags, or config, in the
  order that actually worked. Copy-pasteable, not paraphrased into prose that
  loses a flag or a version number.
- **Why** it's needed: the failure mode this avoids (the error or symptom that
  appears without it), so a future reader recognizes they've hit the same
  problem rather than just being told what to type.
- Scope: what this does and doesn't cover, if there's a plausible near-miss a
  future reader could wrongly assume this also solves.

Keep it as short as the recipe allows. This is a lookup reference for a future
agent mid-task, not a narrative of the debugging session that found it.

## 4. Write, then report

Write the file. This capture is meant to actually exist on disk before the spec
moves to "Awaiting verification" (the tooling-capture rule), not just get
printed as a draft and left there.

Report back: the file path, a one-line summary of what it captures, and whether
it's new or an update to an existing skill. Remind me that the tooling-capture
rule requires this to be referenced in this spec's implementation note (or
explicitly marked "not warranting capture") before `/spec-implement` moves the
tracker entry to "Awaiting verification". That update is `/spec-implement`'s
own step, not this command's. This command's job ends at the skill file.

## 5. Not this command's job: promotion into spec-driven-dev

This only ever writes to the current project's own `.claude/skills/`. It never
touches the spec-driven-dev plugin repo itself. Promoting a matured,
project-local skill into the shared package (re-running the package's own test
suite once more as the "am I sure" check, then tagging that commit
`spec-driven-dev--v{next}`) is a separate, deliberate step the maintainer takes
later, on their own schedule. Don't attempt it, and don't suggest doing it now,
as part of this command.
