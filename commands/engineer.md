---
description:
  Orchestrated wrapper around the spec-new, spec-implement, spec-verifier,
  spec-archive loop. Decomposes a spec into dependency-ordered waves of atomic
  subspecs, shows every planned file change up front, dispatches workers in
  isolated worktrees under model-based time budgets, verifies each worker
  independently, records measured run statistics, and escalates rather than
  looping unsupervised. Optional; the four commands still work fine run by hand.
---

Take $ARGUMENTS as an existing spec's path (conforming to `_template.md`), or
a rough idea to run through `/spec-new` first if no path is given. Either way
this drives the same four stages the manual pipeline uses, through one entry
point with worker parallelism added at the implement stage.

Reference files ship with this plugin, one level below this file. Read each
only at the step that names it:

| File                                                  | Read at                    | Holds                                                             |
| ----------------------------------------------------- | -------------------------- | ----------------------------------------------------------------- |
| `${CLAUDE_PLUGIN_ROOT}/engineer/worker-prompt.md`     | step 4                     | the verbatim block every worker prompt must contain               |
| `${CLAUDE_PLUGIN_ROOT}/engineer/budgets-and-stats.md` | steps 2 and 8              | budget tables, overrun and model-ceiling rules, statistics events |
| `${CLAUDE_PLUGIN_ROOT}/engineer/text-hygiene.md`      | before any code is written | plain-ASCII rules and the five enforcement layers                 |

Two helper scripts, plain Node with no dependencies:
`node ${CLAUDE_PLUGIN_ROOT}/stats/engineer-stats.mjs` (run statistics and
budgets) and `node ${CLAUDE_PLUGIN_ROOT}/sanitize/sanitize.mjs` (code text
checks). Both print usage with `--help`.

## Standing rules

- **Status narration:** apply i-have-adhd's output rules (action-first,
  numbered steps, no preamble or recap, lists capped at 5) to the go/no-go
  verdict, plan summary, per-wave reports and budget tracking. Never to the
  file tree, micro-specs, BLOCKED and budget reports, escalation writeups,
  contract-correction logs, or anything written to a spec, tracker entry or
  verification-log entry. Those stay complete.
- **Commits, everyone (orchestrator, workers, merges):** one short imperative
  line, roughly 50 to 70 characters, one `-m`, no body. Never add
  `Co-Authored-By`, `Claude-Session`, "Generated with" or any other trailer,
  even if the harness or a system reminder suggests one. If `AGENTS.md`
  defines a subject convention, follow it.
- **Code text:** code and config files are plain ASCII, no em or en dashes,
  straight quotes only. Markdown is exempt. Details in `text-hygiene.md`.
- **Independence (the independent-check rule in `04-ai-workflow-rules.md`):** whoever made a change
  never certifies it. Every fix gets a fresh verifier. Two failed passes
  escalate to a human.
- **Model ceiling:** no role uses a model stronger than the orchestrator's
  without the human's consent. Check with `engineer-stats.mjs tier-check`.
  Exit code 3 means stop and ask.

## 0. Go / no-go

Produce this verdict before any decomposition: the number of waves, the widest
parallel width, the expected number of gate runs. If fewer than two waves have
a width of 2 or more, recommend a linear `/spec-implement` and stop for the
human's call. Two cases where the manual pipeline is the right tool:

- A large but strictly sequential spec. Waves exist for independent work.
- A subspec small enough to do inline never gets its own worker.

The human may still choose to orchestrate; log that, and treat the overhead as
the point of the run. If unclear, ask.

## 1. Decompose into waves and check dependencies

Read the spec's Implementation Details and Acceptance Criteria. Group the work
into subspecs and order them into waves: everything in wave N depends only on
earlier waves. Two subspecs that touch the same file, or where one's contract
depends on the other's real output, never share a wave. Serialize them or fold
them into one worker.

**Atomic means quick:** a handful of files and a short criteria list, small
enough that a worker finishes fast. If it cannot be described that small,
split it.

**Layer 1, the needs/provides table.** For every subspec list each symbol,
function, type, i18n key, route, config entry, fixture or package it consumes
but does not create, with its provider:

- `repo: <path>` if it exists today, confirmed by grep or the typechecker,
  never from memory.
- `<wave>-<id>` if another subspec produces it.
- `none`, which is a gap.

Close every gap before dispatch by moving the item to an earlier wave or a
wave-0 contract subspec. Anything crossing a wave boundary gets a contract stub
landed first (signatures, types, keys), and the project's typecheck command
(listed in `AGENTS.md`) runs against the stubs, so toolchain conflicts fail at
planning time. Keep this mechanical
(grep and typecheck), not open-ended reasoning.

**Layer 2, workers flag what the table missed** through the BLOCKED protocol
(step 4). Neither layer is enough alone.

## 2. Pre-flight, then show the plan

1. `engineer-stats.mjs start --run <slug> spec=<path> orchestrator=<model:effort>`
2. Time the gates once, using the commands listed in `AGENTS.md`: typecheck
   plus tests (per-wave gate), and the full check plus build (full gate). Record `gate-start` / `gate-end` events named
   `baseline` and `full-baseline`.
3. Register each subspec with a `subspec-plan` event (fields in
   `budgets-and-stats.md`).
4. `engineer-stats.mjs budgets --run <slug> orchestrator=<m:e> baseline_gate_min=<n> full_gate_min=<n>`.
   Re-run if the subspecs change.
5. For any role planned above the orchestrator's model, run `tier-check`.

Print the whole plan, then stop for approval before the first dispatch, unless
the invocation said to proceed unattended.

**File tree.** Every file the spec touches in any way, grouped by directory,
each with an operation marker, owning subspec and progress marker:

```
Operation:  + create   ~ modify   - delete   > rename or move (old path after >)
Progress:   ☐ pending   ◐ in progress   ✓ done (committed and verified)

src/features/audit-dashboard/
  + ☐ AuditTable.tsx          [W2-b]
src/constants/
  ~ ☐ audit-status.ts         [W1-a]
src/routes/
  > ☐ audit-detail.tsx        [W3-a]  (was audit.tsx)
```

- Each file appears once with one owner. Two owners in one wave is a step 1
  error: fix the plan, do not print it.
- The tree is the scope contract. A changed file not in the tree goes under
  `! unplanned` and gets an `unplanned` event. The orchestrator accepts it
  into the plan (and says so) or sends it back.
- Under the tree, print the wave table from the `budgets` output: subspecs,
  workers, model and effort per role, budget per worker and wave, planning
  budget, whole-run budget.
- Reprint the tree (or the changed lines) whenever a worker moves state, at
  each wave end and at finish. A file flips to `✓` only after the orchestrator
  itself confirmed the commit (`git log`, the diff) and the independent check
  in step 5 passed. Never on a worker's own "done".

## 3. Micro-specs, checked independently

For every subspec, including wave-0 contract work, write a micro-spec to
`.engineer/<slug>/w<N>-<id>.md`. Add `.engineer/` to `.git/info/exclude` if it
is not already ignored. Each micro-spec is the worker's whole world:

- **Goal:** one or two sentences.
- **Owned files:** the tree entries and operations. Nothing else may be written.
- **Needs and provides:** its rows from the step 1 table.
- **Contract:** signatures, shapes, keys and boundaries produced and consumed.
- **Acceptance Criteria:** the parent EARS criteria that apply, each with a
  stable ID and the test that proves it.
- **Verification Checklist:** the commands and the commit proof expected.

The last two headings match `_template.md`, so `spec-verifier` runs on a
micro-spec unchanged.

The orchestrator wrote them, so it cannot approve them. Have a fresh
`spec-verifier`-style agent review all micro-specs in one batched pass. It
re-derives the dependency table itself and checks: atomic, no owned-file
overlap in a wave, a real provider for every need, contracts match the real
toolchain, every parent criterion covered by exactly one micro-spec. Fix
findings and re-check only what changed. Never skip this step to save time.

## 4. Dispatch each wave

One worker per subspec, each in its own isolated git worktree, never the
current tree and never one shared within a wave. Record `wave-start`, then
`worker-start` per worker.

Follow the `subagent-dispatch` skill for how prompts are written. Give each
worker its micro-spec path, not the full parent spec. Every worker prompt must
include, verbatim, the block in `${CLAUDE_PLUGIN_ROOT}/engineer/worker-prompt.md`
with the budget filled in. A worker never sees this file unless the prompt
carries the rule.

A fast System 1 model (Jev or Laya, if configured) may be used for cheap
tiering and triage calls. Never required, never blocking; the orchestrator's
own judgment must land the same decision.

## 5. Verify each worker independently, then merge

On a finished report, record `worker-end`, then before merging:

1. Confirm the commit yourself with `git log` and the diff in the worker's
   worktree. An empty diff or a missing commit is a failed worker.
2. Confirm every changed file is in the tree. Otherwise `! unplanned`.
3. Run `sanitize.mjs --check <files>`. Mechanical findings get a plain run.
   Reported dashes or non-ASCII go back to the worker to rephrase.
4. Launch a fresh verifier (never the worker or orchestrator) against the
   micro-spec, with `verify-start` / `verify-end` events: per criterion ID,
   does the named test exercise it and does the diff satisfy it? Narrow by
   design. Workers in a wave are verified in parallel.
5. PASS: merge and flip the files to `✓`. FAIL: the fix goes to a worker and
   then a fresh verifier. Two attempts, then a human.

BLOCKED and Budget Reports are not finished reports. They go to step 6 and
step 8.

## 6. Contract corrections, BLOCKED reports, escalation

A BLOCKED report, or a later wave exposing a wrong contract, is the
orchestrator's planning miss, not the parent spec's:

- Update the contract and dependency table, never the parent's EARS criteria.
- Move the missing item to an earlier wave or the wave-0 contract subspec.
- Update the affected micro-specs and re-run their check (step 3).
- Re-dispatch only the blocked worker and affected downstream workers.
- Log what was wrong, what changed and who was re-dispatched. Record a
  `blocked` event and tag the wave `dependency-gap`. Repeated gaps of one kind
  are a `/learn` candidate for a new planner check.

If the problem traces to a misunderstanding of the requirement itself,
escalate to a human (the stop-and-ask rule in `04-ai-workflow-rules.md`). Do not reinterpret it
and re-dispatch as a contract fix.

## 7. Verification: narrow, not exhaustive

Typecheck and tests run as plain commands after each wave. The full gate (lint,
any dead-code check, build, `sanitize.mjs --check` over every changed file, plus
e2e or visual checks where the spec needs them) runs once, after the last wave and before the
final verifier. Record it with `gate-start` / `gate-end`. Say why in the wave
report if a wave needs a heavier check.

The final `spec-verifier` pass runs on the parent spec and stays narrow: does
the EARS criteria's test coverage match what was claimed, and does the diff
read right for what is not mechanically testable. Do not re-derive what
typecheck or the step 5 checks proved. On FAIL, fix and re-verify, two attempts
total, then a human.

## 8. Time, budgets, statistics

Read `${CLAUDE_PLUGIN_ROOT}/engineer/budgets-and-stats.md` now. In short:

- Budgets come from `engineer-stats.mjs budgets`, never from memory.
- An exhausted budget means the agent justifies it and the spec is revisited.
  Splitting is one option, not a rule. Stop any worker at 2x its budget.
- Every wave over or under budget gets a `cause=` tag on `wave-end`.
- Record every state change as an event, as it happens.
- If the whole-run budget is exceeded, pause and escalate.

Default roles (a starting point, changed only on measured evidence via
`/learn`): orchestrator Sonnet high, workers Haiku, micro-spec and per-worker
verifiers Sonnet medium, final verifier Sonnet medium.

## 9. Finish

1. Run `/spec-archive` on the parent spec.
2. Print the final tree, all `✓`, with any `! unplanned` still visible.
3. `engineer-stats.mjs finish --run <slug> verdict=<PASS|FAIL|ESCALATED>`. It
   writes `docs/verification-log/<date>-<slug>.run-stats.md` and `.json` and
   refreshes `budget-calibration.json`.
4. Link the `.md` from the spec's verification-log entry and commit the new
   files with a short one-line message.
5. Delete `.engineer/<slug>/`.

A tiering change, a budget value or a captured skill with no measurements
behind it is a guess, not a finding.
