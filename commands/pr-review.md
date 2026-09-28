---
description:
  Review one or more GitHub PRs in parallel, one pr-reviewer agent per PR.
  Each writes an HTML dashboard and a paste-ready markdown comment to
  .reviews/pr-<N>/.
argument-hint:
  <PR#> [<PR#> ...] [--concurrency N] [--no-screenshots] [--force] [--model
  haiku|sonnet|opus]
---

Review the PRs in $ARGUMENTS, dispatching one `pr-reviewer` agent per PR. You
only orchestrate — don't read the reports back yourself, and don't review any
code directly.

**Never post to GitHub, never touch the working tree, and never launch an
agent for a PR that wasn't listed.**

1. **Prepare.** If no PR numbers were given, ask for them and stop. Otherwise
   run `node ${CLAUDE_PLUGIN_ROOT}/pr-review/cli.mjs prepare --prs "<the numbers>"`, passing
   `--force` and `--no-screenshots` through if given. It fetches refs,
   resolves each PR's base and merge commit, skips anything already reviewed
   at the same head, assigns ports, and prints
   `{ launch: [{ PR, prompt, ... }], skipped: [{ pr, reason }] }`. If
   `git check-ignore -q .reviews/x` fails, append `.reviews/` to
   `.git/info/exclude` and mention it once. If the working tree is dirty, say
   it won't be touched.
2. **Launch.** Batch `launch` into groups of `--concurrency` (default 3). For
   each batch, in one message, fire one Agent call per entry:
   `subagent_type: "pr-reviewer"`, `run_in_background: false`, `model` set
   only when `--model` was given, and that entry's `prompt` passed through
   verbatim. If the `pr-reviewer` agent type isn't found (agent files load at
   session start), fall back to `general-purpose` with `model: "sonnet"` and
   prefix the prompt with
   `Read ${CLAUDE_PLUGIN_ROOT}/agents/pr-reviewer.md and follow it exactly.`
   Don't use `isolation: "worktree"` — the agent checks out and always cleans
   up the PR's commits itself.
3. **Summarize**, using only the agents' returned text: a table of PR,
   decision, confidence, blocking count, notes, tier, visual coverage, and
   report path; failed PRs with their stage and reason; skipped PRs with
   their reasons. Offer to open the reports, and close with one line: nothing
   was posted to GitHub, and reports live under `.reviews/`.
