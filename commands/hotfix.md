---
description: Investigate and fix a live bug, following this repo's triage fork,
  tagged-logging discipline, and commit hygiene for hotfixes.
---

Treat $ARGUMENTS as the bug report: the symptom, plus an issue id if one
exists (use it for the `HOTFIX-<issue-id>` tag below, otherwise mint a short
slug).

## Status narration: apply i-have-adhd

Apply i-have-adhd's output rules (action-first, numbered steps, no
preamble/recap/tangents, cap lists at 5) to status updates during
investigation, especially step 3's bisection narration. Never apply them to
the triage decision in step 1 when it's genuinely unclear which fork applies,
or to the tagged log lines themselves. Those stay complete regardless of
active mode.

## 1. Triage fork: decide this before writing any code

- **Regression** (something that used to work and now doesn't): no new spec
  needed. Fix it directly, add a regression test that fails before the fix
  and passes after, and note under the original spec's tracker entry what
  broke and how it was fixed.
- **New requirement** (something that never actually worked as requested, so
  it was never a passing Acceptance Criterion in the first place): this isn't
  a hotfix, it's new scope. Route it through `/spec-new` as an amendment (the
  amendment rule in `04-ai-workflow-rules.md`) instead of fixing it directly.

If it's genuinely unclear which fork applies, say so rather than silently
defaulting to the faster regression path.

## 2. Root-cause investigation: tagged logging only

Any diagnostic logging during investigation uses
`console.log('[HOTFIX-<issue-id>]', ...)`, never a bare `console.log`, so
it's unmistakably distinct from this codebase's existing untagged debug logs.

Commit this logging as the investigation progresses. This is intentional, not
scratch work to leave uncommitted: it's what lets an interrupted session, or
someone else, pick up from git history instead of starting over. If the
project's `.husky/pre-commit` hook checks for `[HOTFIX-` tags, it allows them
on a hotfix or feature branch and blocks them only on `main` or `master`.

## 3. Iterate by bisection, not accumulation

As the hypothesis narrows, remove the previous round's now-irrelevant log
lines rather than piling new ones on top. The tags in place at any moment
should reflect the current hypothesis, not the full history of every one
tried.

## 4. Once the root cause is confirmed, clean up in the same commit as the fix

Strip every `[HOTFIX-<issue-id>]` line in the exact same commit as the fix
itself. Never split this into a "fix" commit followed by a separate
"remove debug logging" commit. A pre-commit hook may catch a tag that slips
past this point, but the discipline is to never depend on the hook catching
it.

Commit messages follow `AGENTS.md`: one short imperative line, no body, no
attribution trailer. Code follows its "Code text rules" (plain ASCII, no
dashes, straight quotes), and if the project has `scripts/sanitize.mjs`, run it
on the files you changed first.

## 5. Handoff boundary with the explorer subagent

`explorer` (`${CLAUDE_PLUGIN_ROOT}/agents/explorer.md`) is read-only. It is
useful for step 1's triage and the early hypothesis-forming part of step 2, but
it cannot plant diagnostic logging since it never modifies files. The moment
step 2 needs actual instrumentation added to source, the main agent takes
over. Don't ask explorer to do this; it structurally can't.
