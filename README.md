# spec-driven-dev

A Claude Code plugin bundling spec-driven-development commands,
agents, skills, and hooks. Kept out of every application repo on purpose —
this process is versioned independently from the code it governs.

**This repo never contains project-specific instructions.** It provides the
_mechanism_ (commands, agents, skills, hooks, the PR review pipeline). Every
project's own rules, history, and specs live in that project's own repo. See
the diagram below if that split isn't obvious yet.

---

## How this fits together

```mermaid
flowchart TB
  A["spec-driven-dev (this repo)<br/>commands, agents, skills, hooks"] --> C["Claude Code session<br/>on your machine"]
  B["your project repo<br/>context docs, specs, history"] --> C
```

This repo is pulled in automatically once you trust the project folder — it
never contains anything project-specific. The project repo is read the
normal way Claude Code already works (`CLAUDE.md` found by walking up from
the working directory, `docs/` read on demand). Neither side knows about the
other directly; they only combine inside the session.

Once a session is running, this is the loop the package's commands drive:

```mermaid
flowchart TB
  A["/spec-new<br/>creates the spec file"] --> B["/spec-implement<br/>implements, updates tracker"]
  B --> C["spec-verifier<br/>independent pass/fail check"]
  C -- "FAIL: fix + retry (max 2, else escalate)" --> B
  C -- PASS --> D["/spec-archive<br/>archives, condenses tracker"]
```

`/engineer` (also in this package) is an optional wrapper around this exact
loop — same four stages, one entry point instead of running each by hand. It
adds worker parallelism, a live file tree, time budgets set from model and
effort, and a measured statistics record for every run.
`/pr-review` is a separate, parallel pipeline that never touches this loop —
it writes to `.reviews/` in the project repo on its own.

---

## What `/spec-archive` hands you at the end

Archiving isn't the last step — it's the handoff back to the human. Two
things come out of it, both generated automatically, neither requiring you
to write anything by hand:

**1. A manual verification script.** The spec's Acceptance Criteria,
translated from EARS notation into concrete, click-by-click actions —
exactly the shape of an E2E test, but meant for you to walk through in the
running app yourself, not for a test runner:

```
Manual verification — Spec 042: request-creation form validation
1. Navigate to /requests/new.
2. Leave "Project name" empty and click "Submit".
3. Expect an inline error: "Project name is required" — form does not submit.
4. Fill "Project name" with "QA test project".
5. Select "GCP" from the "Provider" dropdown.
6. Click "Submit".
7. Expect a confirmation toast: "Request created successfully".
8. Navigate to /requests and confirm "QA test project" appears at the top
   of the list.
```

Criteria that aren't UI-observable (a backend validation rule, a header
check) get translated the same way but with whatever tool fits — curl, an
API client, devtools' network tab — never skipped just because there's no
click to describe. This script is deliberately shaped to be pasted straight
into a PR description's "how was this tested" section, not thrown away
after you run it.

**2. Two separate local commits, already made — not just a suggestion.** Each is one short line with no body and no attribution trailer.
Everything under `docs/` (the archived spec file, the tracker update, the
new verification-log entry, any living-doc update) goes in one commit;
everything else — the actual application code — goes in another. Nothing
is pushed. A reviewer opening the PR later sees one commit that's pure
process and one that's pure code, instead of 20 changed files where only 5
are the feature itself.

```
Archive spec 042 request-creation form validation
Add request-creation form validation
```

If a changed file doesn't cleanly sort into either bucket, that's a
stop-and-ask trigger, not a guess to make silently — the same rule that
governs any other unresolved decision.

Run the manual script before you push, not after — if something's off,
you're fixing it against two clean, already-separated commits instead of
one tangled one.

---

## Commit and code text rules

These apply to every agent, subagent and merge commit this package drives.

- **Commits:** one short imperative line, no body, and never a
  `Co-Authored-By`, `Claude-Session` or any other attribution trailer.
- **Code text:** code and config files (JS/TS, JSON, CSS, YAML, TOML, shell,
  HTML) are plain ASCII English as typed on a US keyboard. No em or en dashes
  (rephrase the sentence, don't swap in a hyphen), straight quotes only, three
  dots not the ellipsis character, no markdown asterisks or heading hashes in
  comments or strings, no non-ASCII characters, no trailing whitespace.
  Markdown files are exempt.

`sanitize/sanitize.mjs` enforces this. It fixes what is mechanical (hidden
characters, unusual spaces, lookalike letters, curly quotes, trailing
whitespace) and only reports what needs a person to rephrase (dashes, other
non-ASCII). Enforcement runs in layers because hooks don't reliably fire in
subagents or git worktrees: the worker's own check, the orchestrator's check on
each worker diff, this plugin's `PostToolUse` hook, the project's Husky
pre-commit hook, and the full gate. The details live in
`engineer/text-hygiene.md`.

---

## What lives here vs. what lives in each project repo

| This package (`spec-driven-dev`)                                                                                                                      | Each consuming project's own repo                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `commands/` — `spec-new.md`, `spec-implement.md`, `spec-archive.md`, `hotfix.md`, `learn.md`, `pr-review.md`, `run-skill-generator.md`, `engineer.md` | `CLAUDE.md`, `AGENTS.md`                                                                   |
| `agents/` — `explorer.md`, `spec-verifier.md`, `pr-reviewer.md`                                                                                       | `docs/context/01`–`06`                                                                     |
| `skills/` — `subagent-dispatch/`, `mock-first-api/`, `playwright-live-verification/`                                                                  | `docs/specs/` (per-developer folders), `docs/specs/_template.md`, `_amendment-template.md` |
| `hooks/` — Context7 key check, the `PostToolUse` sanitize hook, any agent-side enforcement `learn.md` proposes                                        | `docs/specs/archive/`, `docs/verification-log/` (including per-run statistics)             |
| `engineer/` — reference files `/engineer` reads at the step that needs them (worker prompt, budgets and stats, text hygiene)                          | `.husky/` (pre-commit/pre-push — human-edit-side enforcement; can't live in a plugin)      |
| `sanitize/` — `sanitize.mjs` and its tests                                                                                                            | `scripts/sanitize.mjs` — a vendored copy of the file to its left                           |
| `stats/` — `engineer-stats.mjs` (run statistics and budgets) and its tests                                                                            | `.sanitizeignore` (optional exceptions)                                                    |
| `pr-review/` — `cli.mjs` + ~15 modules, fixtures, golden files, tests                                                                                 |                                                                                            |
| `system-one/` — `decide.mjs` and its tests, the optional Laya/Jev decision helper, never required                                                     |                                                                                            |

---

## Dependencies (auto-installed with this plugin)

| Plugin        | Marketplace               | Source                           |
| ------------- | ------------------------- | -------------------------------- |
| `superpowers` | `claude-plugins-official` | built in, no setup needed        |
| `context7`    | `claude-plugins-official` | built in, no setup needed        |
| `ponytail`    | `ponytail`                | `github:DietrichGebert/ponytail` |
| `i-have-adhd` | `i-have-adhd`             | `github:ayghri/i-have-adhd`      |

Enabling `spec-driven-dev` enables all four automatically.

**Maintainers:** `ponytail` and `i-have-adhd` live in other marketplaces, so
both must be listed in `allowCrossMarketplaceDependenciesOn` in this repo's
`marketplace.json`. If a dependency is declared in `plugin.json` and the
allowlist entry is missing, the install completes _without_ it and the
plugin then fails to load. Declaring dependencies in the marketplace entry
instead gives a loud refusal message, which is easier to diagnose.

---

## Optional acceleration: the System One decision helper

Separate from the plugin dependencies above — this isn't a Claude Code
plugin, just an optional classifier a few commands can call for cheap,
structured micro-decisions: model tiering, skill matching, mechanical-diff
detection, PR triage. `system-one/decide.mjs`, bundled in this package,
tries in order:

1. **Laya**, local, if `LAYA_ENDPOINT` responds (default
   `http://127.0.0.1:8765`).
2. **Jev**, hosted, only if `TYPESAFE_API_KEY` is set.
3. Neither → returns `{available: false}` immediately, short timeout.

Every call site follows the same rule: use the decision if one comes back,
decide it yourself exactly as before if it doesn't. **Nothing in this
package may ever assume either is present** — this is a speed/cost
optimization, never a correctness dependency. Setting either up is entirely
optional and outside this package's scope (Laya needs local weights and a
runtime; Jev needs an API key) — deliberately not part of the one-time
setup checklist, because nothing here requires it.

---

## Developing this plugin

- Run `claude --plugin-dir <path-to-this-repo>` to load your working copy for
  one session without installing it. Alternatively, add your checkout as a
  local marketplace (`/plugin marketplace add ./spec-driven-dev`); edits then
  take effect at the next session start or `/reload-plugins`.
- A `--plugin-dir` copy silently shadows an installed plugin of the same name.
  If behaviour looks stale, check which copy is actually loaded.
- If `pr-review/` needs npm packages, keep a `package-lock.json` at the plugin
  root. Claude Code runs `npm ci --ignore-scripts` on install; Yarn and pnpm
  lockfiles are skipped. Because scripts are ignored, Playwright's browser
  download never happens automatically, which is why the one-time setup below
  lists `npx playwright install chromium`.
- `sanitize/`, `stats/` and `system-one/` are plain Node with no dependencies.
  Run their tests with `node --test sanitize/sanitize.check.mjs
stats/engineer-stats.check.mjs system-one/decide.check.mjs`. The `pr-review/`
  tests run with `node --test pr-review/test/*.check.mjs`.
- Plugins run no install scripts, so the sanitizer can't copy itself into a
  project. Projects vendor it once through the bootstrap prompt below.
- Keep `commands/engineer.md` lean (Anthropic's guidance is under about 500
  lines for a main file). New detail goes in a file under `engineer/`, linked
  directly from `engineer.md`, never in a chain of files that link to files.

---

## Do / don't

- **Do** trust the project folder before anything else — that's what
  triggers marketplace registration and plugin install from
  `.claude/settings.json`.
- **Do** keep `autoUpdate` set on the `siddaharthsuman-spec-driven-dev` entry
  in the project's `.claude/settings.json` — we don't pin versions, so this is
  what makes a push actually reach you. Without it, custom marketplaces
  default to auto-update off.
- **Do** run one real, small feature through the full pipeline before
  treating a new project's setup as done.
- **Don't** add a `version` field to `plugin.json` or the marketplace entry.
  With none set, every commit is a new version, so a push reaches everyone.
  With one set, pushes without a version bump never reach anyone.
- **Don't** recreate `.claude/commands/`, `.claude/agents/`, or
  `.claude/skills/` inside a project repo — this package provides them;
  a local copy just drifts out of sync and causes duplicate/conflicting
  triggers.
- **Don't** manually create `docs/specs/<developer>/`, `docs/specs/archive/`,
  or `docs/verification-log/` — the commands create these on first use.
- **Don't** edit anything under `~/.claude/plugins/cache/` directly — it's
  overwritten on the next update. Edit this repo and push instead.
- **Don't** pre-populate a project's "Things Flagged as Uncertain" section
  with guesses. Seed it only with facts that are already true (see the
  bootstrap prompt below for exactly which three), everything else comes
  from `/learn` the first time something actually surprises someone.
- **Do** run the manual verification script `/spec-archive` hands you
  before pushing — it's generated from criteria that already passed the
  automated check, so it's a cheap final look, not redundant busywork.
- **Don't** squash the two commits `/spec-archive` creates back into one
  before pushing. The doc/code split is the whole point — it's what lets a
  reviewer skip the process commit entirely if they trust it.
- **Do** treat the System One decision helper as pure acceleration — every
  call site needs a working fallback for when it's unavailable, not just a
  try/catch that fails loudly.
- **Don't** add a new call site for `decide.mjs` without writing its
  "decide it yourself" fallback in the same change. An accelerator with no
  fallback is a hard requirement wearing a disguise.
- **Don't** expect this plugin in a cloud session (claude.ai/code). Cloud
  sessions never show the trust dialog that `extraKnownMarketplaces` needs.
- **Don't** edit a project's vendored `scripts/sanitize.mjs` by hand. Change
  `sanitize/sanitize.mjs` here, then re-copy it into each project.
- **Don't** let any agent use a model stronger than the `/engineer`
  orchestrator's without the human's explicit consent. Expensive models drain
  the usage quota fast, so this is a hard gate, not a preference.
- **Don't** add attribution trailers to commits or write em dashes, curly
  quotes or other non-ASCII into code files, even when a harness suggests it.

---

## One-time setup, per developer machine

- [ ] Trust the project folder in Claude Code, then run `/reload-plugins` once
      when it prints `Plugins changed. Run /reload-plugins to activate.`
- [ ] Only if `autoUpdate` isn't set in the project's `.claude/settings.json`:
      `/plugin` → **Marketplaces** → select `siddaharthsuman-spec-driven-dev`
      → **Enable auto-update**.
- [ ] _(Optional)_ Context7 API key — get one at
      [context7.com/dashboard](https://context7.com/dashboard), export
      `CONTEXT7_API_KEY` in your shell profile, restart Claude Code. Skippable;
      falls back to the anonymous rate limit, and a `SessionStart` hook
      reminds you if it's unset.
- [ ] _(Only if you'll run `/pr-review`)_ `npx playwright install chromium`
      once — needed for screenshot capture, not installed automatically.
- [ ] _(Per project, once)_ The bootstrap prompt below copies
      `sanitize/sanitize.mjs` into the project as `scripts/sanitize.mjs`. After
      a plugin update that changes the sanitizer, re-copy it.

---

## Bootstrapping a new project

### 1. Wire up the plugin

Create `.claude/settings.json` in the new repo, commit it, then trust the
folder:

```json
{
  "extraKnownMarketplaces": {
    "siddaharthsuman-spec-driven-dev": {
      "source": {
        "source": "github",
        "repo": "SiddaharthSuman/spec-driven-dev"
      },
      "autoUpdate": true
    },
    "ponytail": {
      "source": { "source": "github", "repo": "DietrichGebert/ponytail" }
    },
    "i-have-adhd": {
      "source": { "source": "github", "repo": "ayghri/i-have-adhd" }
    }
  },
  "enabledPlugins": {
    "spec-driven-dev@siddaharthsuman-spec-driven-dev": true
  }
}
```

**What happens on first open:** Claude Code asks you to trust the folder.
After you accept, it clones the marketplaces in the background and prints
`Plugins changed. Run /reload-plugins to activate.` Run `/reload-plugins`
(or restart) once. This works without a manual install because this repo's
marketplace entry uses a relative-path source (`source: "./"`); a plugin
from an external source enabled only in project settings is not fetched
automatically.

**Manual install (fallback, or for user scope):**

```text
/plugin marketplace add SiddaharthSuman/spec-driven-dev
/plugin install spec-driven-dev@siddaharthsuman-spec-driven-dev
```

On Claude Code v2.1.275+ one command does both:
`/plugin install spec-driven-dev --marketplace SiddaharthSuman/spec-driven-dev`.
Choose project scope for a repo the team shares, user scope for personal
use. If this repo is private, git credentials must work without a prompt
(`gh auth login`, or an SSH key already in `known_hosts`).

#### Verify the install

- [ ] Type `/` and confirm the commands appear under `spec-driven-dev`.
- [ ] `claude plugin list` shows the plugin and all four dependencies as
      enabled. The version is a 12-character commit SHA, because there is no
      `version` field on purpose.
- [ ] `/plugin` → **Errors** tab is empty.

### 2. Create the governing docs

This package does not provide these — they're project-specific by design.
**Don't write these by hand.** Paste the block below into a fresh Claude
Code session, in the new project's root, after step 1:

```text
You are bootstrapping the governing documentation for a brand-new project
that will use the spec-driven-dev Claude Code plugin (already installed via
.claude/settings.json). This repo has no prior history — do not invent
non-obvious patterns, invariants, or architecture decisions. Only record
what is genuinely already true.

Before writing anything, ask me these questions, one at a time, and wait for
my answers:
1. What is this project? (one or two sentences: purpose, primary users)
2. What's explicitly out of scope for now?
3. What's the core tech stack? (framework, state management, styling,
   testing tools, package manager, and the typecheck / lint / test / build
   commands — say "not decided yet" for anything open, or "infer from the
   lockfile and package.json" for the commands)
4. Does this project have a UI, or is it backend/library/CLI only?
5. Are we adopting the dual enforcement layer (Husky pre-commit/pre-push,
   alongside this plugin's own agent-side hooks)?

Once I've answered, create the following. Follow the tiered pattern
throughout: each file's core content (invariants, universally-true rules)
stays short; anything detailed or subsystem-specific goes in a separate,
linked file read only when relevant — never inline everything "just in
case."

1. CLAUDE.md — one line, "@AGENTS.md", plus a one-line note that
   commands/agents/skills/hooks come from the spec-driven-dev plugin, not
   this repo.

2. AGENTS.md — the shared rulebook:
   - A "read this first" list pointing to docs/context/01-06 (05 conditional
     on UI work).
   - The spec-creation convention — /spec-new derives the developer's folder
     from `git config user.name` (slugified): docs/specs/<developer>/00X-name.md,
     numbered per-developer, never globally.
   - A "Commits" section: one short imperative line, no body, and never a
     Co-Authored-By, Claude-Session, or any other attribution trailer.
   - A "Code text rules" section: code and config files (JS/TS, JSON, CSS,
     YAML, TOML, shell, HTML) are plain ASCII English as typed on a US
     keyboard. No em or en dashes (rephrase the sentence, don't swap in a
     hyphen). Straight quotes only, three dots not the ellipsis character. No
     markdown asterisks or heading hashes inside code comments or strings. No
     non-ASCII characters, no trailing whitespace. Markdown files are exempt.
     Point at `node scripts/sanitize.mjs <files>` (add --check to only
     report), say it is a vendored copy from the plugin and is not edited
     here, and say exceptions go in `.sanitizeignore`.
   - Build/test commands from my stack answers.

3. docs/context/01-project-overview.md — purpose, users, explicit non-goals,
   from my answers. Short — this is always-loaded core.

4. docs/context/02-architecture.md — short core only: real stack facts I
   gave you, plus a "Things Flagged as Uncertain" section seeded with
   exactly these three, since they're already true today, not speculation:
   - Commands/agents/skills/hooks live in the external spec-driven-dev
     plugin, not this repo — don't recreate .claude/commands/ locally.
   - Spec numbering is scoped per-developer folder, not one global sequence.
   - The plugin marketplace auto-updates (autoUpdate is set in
     .claude/settings.json) — a stale-looking cached plugin isn't a bug to
     hand-fix locally.
   Add nothing else here. Everything else gets discovered and added via
   /learn as the project actually runs.

5. docs/context/03-code-standards.md — naming/lint/format rules from my
   stack answers. If I said "not decided," leave a stub noting that; don't
   invent conventions. Include a "Text hygiene" section with the same rules
   as AGENTS.md's "Code text rules", in more detail: what the sanitizer fixes
   on its own (hidden characters, unusual spaces, lookalike letters, curly
   quotes, the ellipsis character, trailing whitespace, markdown markers in
   comments), what it only reports (dashes, other non-ASCII), and the
   `.sanitizeignore` escape hatch.

6. docs/context/04-ai-workflow-rules.md — the full rule set, written
   complete, not phased in:
   - One spec at a time; concurrent work uses separate git worktrees, never
     the same working tree.
   - Read the progress tracker in full before starting any spec.
   - Stop and ask — never guess — when the spec and 02-architecture.md
     don't resolve a decision. Authority order: spec > 02-architecture.md >
     other context docs > existing code > generated docs.
   - Commits are one short line with no attribution trailers, from every
     agent, subagent and merge commit, even when a harness suggests a
     trailer. Code files follow the text rules in 03-code-standards.md.
   - Only an independent check (spec-verifier or a human) can mark a spec
     Completed. A FAIL keeps it at Awaiting Verification; an automatic
     fix-and-reverify loop is capped at two attempts before escalating to a
     human. The verifier's own job is narrow and deliberately not
     mechanical: typecheck, tests, and build run as plain commands and cost
     no LLM tokens at all — the verifier confirms the EARS criteria's test
     coverage actually matches what was asked, and reads the diff for
     anything genuinely not mechanically testable.
   - /hotfix forks on triage: a regression gets logged and fixed under a
     [HOTFIX-<id>] tag with same-commit removal discipline once resolved;
     a request that's actually a new requirement gets redirected to
     /spec-new instead of hot-fixed in place.
   - Never weaken a test to make it pass.
   - /learn escalation: a one-off gap gets a doc correction; a mistake
     flagged twice proposes an enforcement mechanism instead — branching
     explicitly on agent-side (a Claude Code hook, lives in the plugin) vs.
     human-edit-side (a Husky script, lives in this repo's .husky/) — never
     assume one location for both.
   - Non-trivial tooling discoveries (>10 min of trial-and-error) get
     captured as a skill in .claude/skills/ in this repo before moving to
     Awaiting Verification — local staging, promoted into the plugin
     package in a later release, not written directly into the package.
     Promotion is a deliberate moment, not an ordinary commit: re-run the
     package's own test suite once more as the "am I sure" check, then tag
     the commit spec-driven-dev--v{next} (the {plugin-name}--v{version}
     format Claude Code's plugin system already resolves) so the promotion
     leaves an addressable checkpoint behind.
   - New specs start from clarifying questions or a guided brainstorm, never
     hand-written straight from a rough idea for anything non-trivial.
   - Completed specs are immutable — changes go through a numbered amendment
     spec; multi-hop amendment chains point their forward-pointer at the
     original spec, never an intermediate one.
   - /spec-archive condenses a Completed entry to 1-2 lines and moves the
     full narrative to docs/verification-log/<developer>-<number>-<name>.md,
     as one atomic step with the file move and living-doc update.
   - /spec-archive's final output, as part of that same atomic step: (a) a
     manual verification script translating the spec's Acceptance Criteria
     into concrete click-by-click actions for a human to run before
     pushing, shaped to double as PR description content; (b) the working
     tree split into two separate local commits, never pushed automatically
     — everything under docs/ in one commit, actual application code in
     another. A file that doesn't cleanly sort into either bucket is a
     stop-and-ask case, not a guess.
   - Orchestrated implementation (/engineer): work is decomposed into
     dependency-ordered waves, each wave's subspecs dispatched to separate
     workers in isolated git worktrees with no shared files — a worker
     never writes a file another worker in the same wave owns. A spec
     that's large but sequential stays a single implementation, not a
     forced decomposition, and a subspec small enough to just do inline
     never gets dispatched — dispatch overhead isn't free. If a later wave
     reveals an earlier wave's contract was wrong, the orchestrator updates
     the contract (not the parent spec's EARS criteria, which describe the
     requirement, not the orchestrator's translation of it), re-dispatches
     affected downstream workers, and logs the correction — never silently.
     If the issue traces back to a genuine misunderstanding of the
     requirement itself, not just the decomposition, escalate to the human
     instead, the same as unresolved ambiguity.
   - Each /engineer subspec gets a temporary micro-spec in .engineer/<slug>/
     (git-ignored), reviewed by a fresh agent before dispatch. The
     orchestrator that wrote them never approves them.
   - /engineer's default roles: Sonnet at high effort for the orchestrator
     (the one serial, high-leverage step — a wrong decomposition corrupts
     every worker built against it), Haiku for workers, Sonnet at medium
     effort for the verifier — a starting point to validate empirically
     against real metrics, not a fixed rule. No role, a retry included, uses
     a model stronger than the orchestrator's without my explicit consent,
     asked with the role, the model, the reason and the extra usage cost, and
     recorded in the run's statistics.
   - /engineer guardrails: before dispatching, the orchestrator surfaces its
     planned wave/worker count and every planned file change as a sanity
     check against runaway fan-out. Each wave and the whole run have a time
     budget derived from size, model and effort. An exhausted worker budget
     is justified in a Budget Report and the micro-spec is revisited
     (splitting is optional). A worker is stopped at 2x its budget, and an
     exceeded whole-run budget pauses and escalates to a human rather than
     continuing unsupervised.
   - /engineer metrics are measured, not remembered: each run writes
     docs/verification-log/<date>-<slug>.run-stats.md (for people) and
     .run-stats.json (for tools) with planned vs. actual time, models,
     attempts, BLOCKED reports, verifier verdicts, gate times, tokens,
     unplanned files and consent decisions. budget-calibration.json in the
     same folder is refreshed from them and replaces the default budget
     tables once a size, tier and effort has 3 samples.
   - Text hygiene is enforced in layers because hooks don't fire everywhere:
     the worker's own sanitizer run, the orchestrator's check on each worker
     diff, the plugin's PostToolUse hook, the Husky pre-commit check, and the
     full gate.
   - Model-tiering, skill-matching, mechanical-diff, and PR-triage
     decisions may optionally call this package's system-one/decide.mjs
     helper for a fast, cheap answer. Never required — every one of these
     decisions has a normal, judgment-based fallback, and nothing may
     assume the helper is present.

7. docs/context/05-ui-context.md — only if I said this project has a UI.
   Design tokens and component conventions from my stack answers; otherwise
   skip this file entirely.

8. docs/context/06-progress-tracker.md — just the section headers: In
   Progress / Awaiting Verification / Completed / Deprecated-Removed, each
   empty. No pre-adoption backfill — there's no prior history.

9. docs/specs/_template.md — EARS-format spec template: Goal, Design
   Decisions, Implementation Details, Dependencies, Acceptance Criteria
   (EARS notation), Verification Checklist.

10. docs/specs/_amendment-template.md — same shape, scoped to
    Added/Modified/Removed relative to the spec it amends, with an Amends:
    field pointing at the original.

11. scripts/sanitize.mjs — a vendored, unchanged copy of the plugin's
    sanitize/sanitize.mjs. Find the plugin's install folder under
    ~/.claude/plugins/ (the marketplace clone or cache) and copy the file. If
    you can't find it, stop and tell me instead of writing your own version.

12. Make sure .engineer/ (the temporary /engineer working folder) is ignored:
    add it to .gitignore.

13. If I said yes to the dual enforcement layer: scaffold
    .husky/pre-commit and .husky/pre-push running checks that match my
    stack answers, and wire package.json's prepare script.
    - pre-commit: lint on staged files, typecheck, a check that blocks
      `[HOTFIX-` log tags on main or master only (allowed on other branches,
      per /hotfix), and `node scripts/sanitize.mjs --check --staged`.
    - pre-push: the full check command, then build.
    - Confirm .husky/_ is ignored, and tell me plainly that Husky 9's default
      hooks folder doesn't exist in new git worktrees, so the pre-commit
      hook won't fire there. Don't try to work around it without asking me.

Do not pre-create docs/specs/<developer>/, docs/specs/archive/, or
docs/verification-log/ — those come into existence the first time /spec-new,
/spec-archive or /engineer actually runs. Show me the full file list you're
about to create before writing anything, and stop for my confirmation.
Afterwards, list anything you left as a stub or couldn't verify, and don't
claim any hook or check works until you've run it.
```

### 3. Validate before treating it as "the standard"

Run one real, small, bounded feature through the full pipeline —
`/spec-new` → `/spec-implement` → `spec-verifier` → `/spec-archive` — and
confirm concretely, don't assume. Treat this pass as the system's first
real feedback loop, not a formality to clear — iterating on the rules
themselves here is expected, not a failure:

- [ ] The progress tracker entry condensed to 1–2 lines on archive, with the
      full narrative moved to `docs/verification-log/`.
- [ ] A self-applied fix after a verifier FAIL correctly required a second,
      independent pass rather than self-certifying.
- [ ] If Husky is set up: a deliberately-introduced issue is caught by
      _both_ the agent-side hook and the human-edit-side Husky check.
- [ ] A dash or curly quote introduced on purpose in a `.ts` file is caught by
      `node scripts/sanitize.mjs --check` and by the Husky pre-commit hook, and
      a commit made by an agent has one short line and no attribution trailer.
- [ ] With neither Laya nor Jev configured, a tiering or triage decision
      still completes correctly on the agent's own judgment — the helper's
      absence should be invisible to the outcome, not just non-fatal.
- [ ] Run the same feature (or a second small one) through `/engineer` end
      to end instead of the commands by hand — the first real exercise of
      the orchestrator/worker/verifier pipeline, including at least one
      multi-subspec wave if the work genuinely parallelizes.
- [ ] After that `/engineer` run, `docs/verification-log/` holds a
      `*.run-stats.md` file and `budget-calibration.json`, and `.engineer/`
      is gone.

---

## Troubleshooting

| Symptom                                                     | Likely cause                                                          | Fix                                                                                                                                                                                          |
| ----------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No commands after first trust                               | Marketplace clones in the background                                  | `/reload-plugins` or restart; check `/plugin` → **Errors**                                                                                                                                   |
| `Plugin "…" not cached at …`                                | Enabled but not fetched yet                                           | `/plugin` to refresh, or use the manual install                                                                                                                                              |
| `… is enabled in project settings but isn't installed here` | External-source plugin enabled only in project settings isn't fetched | `claude plugin install <name>@<marketplace> --scope project`                                                                                                                                 |
| Plugin loads but dependencies are missing                   | Allowlist entry missing (see Dependencies)                            | Fix `marketplace.json`, then `/reload-plugins`                                                                                                                                               |
| Pushed a change, nothing updates                            | Auto-update off, or a `version` field is set                          | Enable `autoUpdate`; remove `version`; or run `claude plugin marketplace update siddaharthsuman-spec-driven-dev` then `claude plugin update spec-driven-dev@siddaharthsuman-spec-driven-dev` |
| Commit in a worker's worktree skipped the sanitize check    | Husky 9's default hooks folder isn't created in new worktrees         | Expected. The worker's own check and the orchestrator's diff check cover it. To make the hook fire there, point `core.hooksPath` at a tracked or absolute folder                             |
| An Edit fails right after a Write or Edit on the same file  | The `PostToolUse` sanitize hook rewrote the file                      | Re-read the file before the next Edit on it                                                                                                                                                  |
| `/engineer` stopped and asked about a model                 | A role was planned on a model stronger than the orchestrator's        | Answer the consent question, or pick a model at or below the orchestrator's; `tier-check` exits with code 3 in this case                                                                     |
