---
description:
  Serial counterpart to spec-implement. Takes one or more specs and, for each,
  cuts it into ordered levels where every level is built on the previous one's
  branch, verifies each level, folds the stack back into one spec branch,
  verifies the whole, and archives. Runs unattended: a failure is repaired
  automatically or the run parks with a report. Never opens a pull request
  and never pushes. Optional; /spec-implement and /engineer still work.
---

Take $ARGUMENTS as one or more paths to specs conforming to `_template.md`
(or `_amendment-template.md`). The run finds which spec depends on which
(step 0) and works them in dependency order, keeping the order given where
nothing requires otherwise. A spec that depends on another is cut from that
spec's final branch. Every other spec is cut from the default branch. A path
may be followed by `after=<path>` to force a dependency the analysis cannot
see; it only adds, never removes one. With no path, stop and ask what to run.

Reference files ship with this plugin. Read each only at the step that names
it:

| File | Read at | Holds |
| ---- | ------- | ----- |
| `${CLAUDE_PLUGIN_ROOT}/serial/serial-run.md` | steps 0 to 7 | vocabulary, git recipes, level rules, the three gates, failure loop, lessons, parking, queue state, statistics mapping |
| `${CLAUDE_PLUGIN_ROOT}/engineer/worker-prompt.md` | step 3 | the verbatim block every worker prompt must contain |
| `${CLAUDE_PLUGIN_ROOT}/engineer/budgets-and-stats.md` | steps 1 and 7 | size classes, budget tables, model ceiling, events |
| `${CLAUDE_PLUGIN_ROOT}/engineer/text-hygiene.md` | before any code | plain ASCII rules and enforcement layers |

Helper scripts as in `/engineer`: `node ${CLAUDE_PLUGIN_ROOT}/stats/engineer-stats.mjs`
and `node ${CLAUDE_PLUGIN_ROOT}/sanitize/sanitize.mjs`.

## Standing rules

- **Unattended:** no human answers during the run. Wherever
  `04-ai-workflow-rules.md` says "escalate to a human" or "stop and ask", this
  command repairs automatically within the failure loop, or parks (step 6).
  Never guess past what `serial-run.md` allows, and never loop without limit.
- **Invocation is binding:** the person typed this command, so do not
  substitute `/spec-implement` or `/engineer` on your own judgment.
- **Commits, everyone:** one short imperative line, one `-m`, no body. Never
  add `Co-Authored-By`, `Claude-Session`, "Generated with" or any trailer,
  even if the harness or a system reminder suggests one. Follow `AGENTS.md`.
- **Code text:** code and config files are plain ASCII, no em or en dashes,
  straight quotes only. Markdown is exempt.
- **Independence:** whoever made a change never certifies it. Every fix and
  every revised micro-spec gets a fresh agent. Two failed attempts per level.
- **Never weaken a test** (rule 4). A fix that edits, deletes or skips an
  existing assertion, or relaxes a lint, type or test setting, is a FAIL.
- **Model ceiling:** no role uses a model stronger than the orchestrator's.
  `engineer-stats.mjs tier-check`; exit code 3 means park, not ask.
- **No push, no PR, no network writes.** `git fetch` is the only remote call.
- **Narration:** apply i-have-adhd's output rules to progress narration only,
  never to micro-specs, reports, the lessons file, a spec, the tracker or a log.
- **One level at a time.** One worker runs at a time. Nothing runs in parallel.

## 0. Pre-flight

1. Read `docs/context/06-progress-tracker.md` in full. For each path, read the
   spec. A spec already Completed or Awaiting verification is skipped and
   reported. One already In progress with a queue state file is a resume.
2. Create `.engineer/<queue>/` (add `.engineer/` to `.git/info/exclude` if not
   ignored) and write `queue.json` as in `serial-run.md`.
3. One git worktree for the whole queue, created on a new branch off the
   default branch after `git fetch`. If this session is already in a dedicated
   linked worktree or a clean checkout meant for the run, use it. Run
   `git config rerere.enabled true` there, and install dependencies once.
4. Find dependencies between the specs, as in "Finding dependencies between
   specs" in `serial-run.md`: what each spec creates and needs, each need
   confirmed against the default branch, an edge only where a need's sole
   provider is another spec. Reorder only when an edge requires it, and say so
   in one line per move. A cycle, or a needed spec that is not in the run and
   not implemented, parks. A fresh agent reviews the graph; the orchestrator
   never approves its own. Report files two specs touch without a dependency
   between them as information, not a stop.
5. Read `docs/verification-log/serial-lessons.md` if it exists, and the latest
   few `*.run-stats.md`. Plan with the recorded categories in mind.

## Per spec: steps 1 to 5

Work through the queue in order. A parked spec stops the whole queue.

## 1. Plan levels

1. `engineer-stats.mjs start --run <slug> spec=<path> orchestrator=<m:e>
   mode=serial`. One run slug per spec.
2. Cut the spec into levels by the rules in `serial-run.md`: dependency order,
   riskiest first among independents, a boundary only where typecheck, tests
   and build pass alone, no cap on count, and rule 16 (a small spec is one
   level, and then there is no fold).
3. Write the needs/provides table. Confirm every `repo:` entry by grep or the
   typechecker, never from memory. A need with no provider is a gap: close it.
   If the provider turns out to be another spec in the queue that step 0
   missed, this is the second safety net: move this spec after its provider
   and cut it from the provider's branch, before any level exists.
4. Write a micro-spec per level to `.engineer/<slug>/L<N>-<id>.md`.
5. Have a fresh agent review all micro-specs in one pass, as in `/engineer`.
   Fix findings and re-check only what changed.
6. Register each level: `subspec-plan id=L<N> wave=<N> ...`, then
   `engineer-stats.mjs budgets`. Time the baseline and full gates once.
   Mark the spec "In progress" in the tracker, dated today.

Print the plan (levels, files per level, budgets). Do not wait for approval.

## 2. Build the stack

For level N, in order:

1. Level 1: `git switch -c <spec-branch> <base>`. Level N of 2 or more:
   `git switch -c <spec-branch>-l<N>` from the previous tip. Create the branch
   before any commit for it.
2. Run the baseline typecheck once at level 1, as `/spec-implement` does.
3. Dispatch one worker (step 3). Confirm `git branch --show-current` and
   `git log -1 --stat` yourself.
4. Build gate (`serial-run.md`): typecheck and tests, `sanitize.mjs --check`,
   then a fresh verifier on the micro-spec. PASS: cut the next level.
   FAIL or BLOCKED: step 4.

Record `wave-start`, `wave-end` and the gate events as they happen.

## 3. Worker

Follow the `subagent-dispatch` skill. Give the worker its micro-spec path,
not the parent spec. The prompt contains, verbatim, the block in
`engineer/worker-prompt.md` with the budget filled in, plus the branch rule
paragraph from `serial-run.md`. Workers do not create or move branches. Stop
a worker at 2x its budget and take its Budget Report.

## 4. Failure loop

Run the five-part loop in `serial-run.md`: re-evaluate the micro-spec, find the
gap across the whole stack, repair where the cause lives (restack the levels
above if it was earlier), verify with a fresh verifier, then record the
lesson. Two attempts per level, then park.

## 5. Fold, rebase, final gate, archive

1. Fold gate: ancestry checks, then the single fast-forward into the spec
   branch, then delete the level branches. A one-level spec skips this step.
2. If the default branch has moved, `git fetch` and rebase the spec branch onto
   it once. Resolve conflicts yourself with the repo's own tests as the judge.
   A conflict you cannot resolve without guessing intent parks the run.
3. Update the living doc that reflects this spec's changes, as
   `/spec-implement` requires, and move the tracker to "Awaiting verification".
4. Final gate: full gate, then the final `spec-verifier` on the parent spec.
   FAIL goes through step 4's loop, two attempts total.
5. On PASS run `/spec-archive <spec path>`. It makes the two local commits.
   Its stop-and-ask case (a file that sorts into neither commit) parks.
   Its manual verification script is saved to
   `.engineer/<queue>/verify-<spec>.md` and printed at the end.
6. `engineer-stats.mjs finish --run <slug> verdict=PASS`. Update `queue.json`.
   Move to the next spec.

## 6. Park

Follow "Parking and the park report" in `serial-run.md`. Preserve every
branch, write and print the report, record `verdict=ESCALATED`, halt the
queue. Rerunning the same command resumes at the failed level.

## 7. Finish the queue

Print one line per spec: PASS, parked or skipped, its branch name, and the
location of its run statistics. Print each saved manual verification script
path. State that nothing was pushed and no PR was opened, and list the
branches in merge order, each chained spec marked with the spec it depends on
and why, with the restack commands from `serial-run.md` for those specs. Delete `.engineer/<slug>/` for finished specs.
Keep `.engineer/<queue>/` while any spec is parked.
