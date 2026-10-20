# Serial run: reference

Read by `/spec-implement-serial` at the step that names each section. Parallel
(wave) mode lives in `commands/engineer.md` and `engineer/`. This file never
changes that mode.

## Contents

- Vocabulary and why these words
- Branches and git recipes
- Levels: how to cut them
- The three gates
- Worker prompt additions
- Failure loop
- Lessons file
- Parking and the park report
- Queue state file
- Statistics without a script change

## Vocabulary and why these words

| Word | Meaning here |
| ---- | ------------ |
| Spec | One feature spec, as in `_template.md`. The unit a developer asks for. |
| Level | One subspec of a spec, built on top of the previous level. Level 1 is the base. |
| Stack | The chain of levels of one spec, level 1 at the bottom. |
| Fold | Merging a level into its parent. Folding every level into level 1 is the collapse. |
| Queue | The specs passed to one run, worked one after another. |
| Park | Stop with everything preserved and a report written. Replaces "escalate to a human" in an unattended run. |

Reasoning, so the choice is not re-debated later:

- **Level** is the word the person who designed this mode used for the work,
  and it reads naturally ("level 3 needs level 2").
- **Stack** and **fold** match Graphite, git-spice and stax, so their
  documentation maps onto this one.
- **Wave** is not used. Rules 15 to 22 of `04-ai-workflow-rules.md` already
  define a wave as a parallel group, and a serial level is the opposite.
- **Layer** is not used. GitHub uses it for per-level pull requests, and a
  serial run has none.
- **Step and task** are not used. "Subspec" and "micro-spec" already exist.
  A level is a subspec with an order, and its file is still a micro-spec.

A serial run opens no pull requests and never pushes. Its result is a
verified local branch per spec. Opening a PR is the person's choice.

## Branches and git recipes

Names, with `<spec-branch>` = `<developer>/<NNN>-<short-name>` (the spec's file
name without `.md`):

- Level 1 is the spec branch itself: `<spec-branch>`.
- Level N for N of 2 or more: `<spec-branch>-l<N>`.

One git worktree serves the whole queue (see the command). `<base>` is the
default branch after `git fetch`, or the previous spec's branch when the spec
carries `after=`.

```
# start a spec (once)
git switch -c <spec-branch> <base>

# cut the next level: BEFORE any commit for it, from the current tip
git switch -c <spec-branch>-l<N+1>

# ancestry check before folding: every pair must succeed
git merge-base --is-ancestor <level N> <level N+1>

# fold the whole stack: one fast-forward, then delete the level branches
git switch <spec-branch>
git merge --ff-only <spec-branch>-l<top>
git branch -d <spec-branch>-l2 ... <spec-branch>-l<top>

# restack after fixing level K (record the old tip first)
OLD=$(git rev-parse <level K>)
#   ... commit the fix on <level K> ...
git rebase --update-refs --onto <level K> $OLD <top level>

# main moved: rebase the folded spec branch once
git fetch origin
git rebase origin/<default> <spec-branch>

# an earlier chained spec was squash-merged by the person: replay only
# this spec's own commits
git rebase --onto origin/<default> <old tip of the earlier spec> <spec-branch>
```

`git rebase --update-refs` needs Git 2.38 or later; check `git --version` once.
Enable `git config rerere.enabled true` in the worktree so a conflict resolved
once is reused. Never use `git push`. Never delete a level branch before the
fold succeeded. Never use `git checkout` to move a branch ref.

A fast-forward fold is expected. If `--ff-only` refuses, a level was changed
without restacking: fix that (restack recipe), do not fall back to a merge
commit and hope.

## Levels: how to cut them

- Order by dependency, foundations first. For a frontend like this one:
  types and mock API, then state and hooks, then components, then routes,
  then stories and end-to-end tests. Among independent pieces put the riskiest
  first, so a failure is found before much is built on top of it.
- A level boundary exists only where the repo passes typecheck, tests and
  build on its own. If a candidate level cannot, merge it with its neighbour.
- Size limits are the `/engineer` ones (`engineer/budgets-and-stats.md`: XS, S,
  M, nothing larger). There is no cap on the number of levels.
- Rule 16 applies. A spec that is small, or large but strictly one piece of
  work, is one level, and there is nothing to fold. Do not split to look
  thorough.
- Each level gets a micro-spec in `.engineer/<slug>/L<N>-<id>.md`, with the
  same headings as `/engineer` micro-specs (Goal, Owned files, Needs and
  provides, Contract, Acceptance Criteria, Verification Checklist). A level
  may consume anything an earlier level produced; the needs/provides table
  records which. A need with no provider is a gap: close it before building.
- A fresh `spec-verifier`-style agent reviews all micro-specs in one pass
  before level 1 starts (rule 21). The planner never approves its own plan.

## The three gates

1. **Build gate**, after each level and before the next level is cut. Run the
   project's typecheck and tests (the commands in `AGENTS.md`), run
   `sanitize.mjs --check` on the level's files, then a fresh verifier checks
   the level's micro-spec. Because each level contains everything below it,
   this also re-checks the earlier levels' tests. A FAIL goes to the failure
   loop.
2. **Fold gate**, after the last level passes. Mechanical only: every
   ancestry check passes, the fast-forward succeeds, typecheck and tests pass
   on the folded branch. A full verifier is needed only if the fold was not a
   clean fast-forward or a restack happened since the last build gate.
3. **Final gate**, on the folded spec branch after any rebase onto a moved
   main: the full gate (lint, dead-code check, build, sanitize over every
   changed file, end-to-end or visual checks the spec needs), then the final
   `spec-verifier` pass on the parent spec, narrow as in `/engineer` step 7.
   Update the living doc before this gate, as `/spec-implement` requires.

Gate times are recorded with `gate-start` and `gate-end` events named
`level-<N>`, `fold` and `final`.

## Worker prompt additions

Use the verbatim block in `engineer/worker-prompt.md`, plus this paragraph.
The orchestrator creates every branch; a worker only commits.

```
Branch rule. You are on branch <branch>, in the shared worktree. Commit only
on this branch. Do not create, switch, rebase, merge, reset or delete
branches, and do not run git push. If the branch is not <branch> when you
start, stop and report BLOCKED. Edit nothing that is not in your micro-spec's
owned files, and never edit, delete or skip an existing test assertion.
```

One worker runs at a time. The orchestrator confirms `git branch --show-current`
and `git log -1 --stat` itself before and after each worker.

## Failure loop

Everything is automatic. A failure is a failed gate, a BLOCKED report, a
Budget Report, or a verifier FAIL. For each one, in order:

1. **Re-evaluate the micro-spec.** Re-read the failing level's micro-spec
   against its report. Was the scope, contract or criteria wrong or unclear?
2. **Find the gap across the whole stack.** Check the needs/provides table,
   the parent criteria, the verifier's per-criterion findings and the diff.
   Decide which level holds the cause. It is often an earlier level.
3. **Repair where the cause lives.** Fix the micro-spec if it was wrong, and
   have a fresh agent review the revised micro-spec (rule 21; the one who
   wrote it never approves it). Rebuild the level. If the cause was in an
   earlier level, fix that level and restack everything above it with the
   recipe above, then re-run the build gate for each level above.
4. **Verify with a fresh verifier.** The agent that fixed it never certifies
   it. The verifier must also FAIL any fix that edits, deletes or skips an
   existing test assertion, or relaxes a lint, type or test setting (rule 4).
5. **Record the lesson** in the lessons file (below) once the repair has
   succeeded. Not before: a lesson from a fix that did not work is noise.

Two attempts per level (rule 7). A third failure parks the run. A whole-run
budget that is exceeded parks the run at the next level boundary, never in the
middle of a level. A requirement that was misunderstood, not just mis-split,
is not repaired by editing the micro-spec: park (rule 17).

The decision rules that normally say "stop and ask" (rule 3, a spec that does
not cover a decision) work like this in an unattended run: choose the most
conservative reading that the spec, then `02-architecture.md`, then the other
context docs, then existing code support, write the choice down in the level's
micro-spec under a `Decisions` heading, and let the verifier check it. If no
conservative reading exists, park.

## Lessons file

`docs/verification-log/serial-lessons.md`, appended to, one entry per
repaired failure:

```
## <date> <spec> level <N>
- Category: dependency-gap | contract-gap | scope-too-big | requirement-misread
  | test-gap | tooling | other
- What failed:
- Where the cause actually was (level and file):
- Fix:
- Planner check to add:
```

The planner reads this file at the start of every serial run, and plans with
the categories it holds in mind (as `/engineer` reads past run statistics).

This file is the only place the run records lessons. The run does not edit
`docs/context/`, `hooks/`, `.husky/` or any command, and `/learn` is not run
unattended. If a category reaches a second entry, the run also writes a
proposal for an enforcement mechanism to
`docs/verification-log/serial-proposals.md`, in the shape `/learn` uses
(agent-side hook, human-edit-side Husky script, or both). A proposal is text
for a person to apply. Nothing is installed.

## Parking and the park report

Park when the failure loop is exhausted, a requirement was misread, a
conflict cannot be resolved without guessing intent, the whole-run budget is
exceeded, or `/spec-archive` meets a file that sorts into neither commit.

Parking leaves everything in place:

- Level and spec branches, as they are. No deletion, no reset.
- No archive and no PR. The tracker entry stays at "In progress" if a level
  failed, or "Awaiting verification" if only the final verifier failed.
- The queue halts. Later specs may be cut from this one's result.
- The queue state file records the failed level.

The report is printed and written to `.engineer/<queue>/park-<spec>.md`, and
`engineer-stats.mjs finish` is run with `verdict=ESCALATED`. Contents: the
spec and level, the failing criterion or command with its output, the
failure-loop attempts and what each changed, the cause as best known, the
state of every branch (name and tip commit), and the exact command to resume.

Resume is running the same command again. It reads the queue state file and
continues at the failed level on the existing branches. It never starts
over silently.

## Queue state file

`.engineer/<queue>/queue.json`, git-ignored, rewritten after every spec and
every level:

```
{
  "queue": "<slug>",
  "worktree": "<absolute path>",
  "default_branch": "main",
  "specs": [
    { "path": "docs/specs/dev/001-x.md", "after": null,
      "status": "done|running|parked|pending",
      "branch": "dev/001-x", "levels": 3, "level_done": 3,
      "failed_level": null, "run_slug": "<stats run>" }
  ]
}
```

The orchestrator may be restarted at any point, including by a context limit.
Everything needed to continue is on disk: this file, the micro-specs, the
branches and the stats events.

## Statistics without a script change

`engineer/budgets-and-stats.md` and `stats/engineer-stats.mjs` work as they are.
Register each level as its own one-subspec wave:

- `start --run <slug> spec=<path> orchestrator=<m:e> mode=serial`
- `subspec-plan id=L<N> wave=<N> size model effort files criteria`
- `wave-start` and `wave-end` with `wave=<N>` around each level
- `worker-start`, `worker-end`, `verify-start`, `verify-end` with `id=L<N>`
- `gate-start` and `gate-end` named `level-<N>`, `fold` and `final`

The script's wave budget is the longest worker plus longest verifier plus a
gate plus 2 minutes, and the run budget adds every wave. With one worker per
wave that is exactly the serial sum, so no parallel-mode number is distorted.
Calibration is keyed by size, tier and effort, which a level shares with a
parallel worker of the same size, so the data is shared on purpose. One stats
run per spec; the queue is the list of runs.

Two small additions are left for a later change to the script, not made now:
printing `mode` in the report, and a `queue` field linking runs.
