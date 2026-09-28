---
description:
  Orchestrated wrapper around the spec-new → spec-implement → spec-verifier →
  spec-archive loop — decomposes a spec into dependency-ordered waves,
  dispatches workers in isolated worktrees, and escalates rather than looping
  unsupervised. Optional; the four commands still work fine run by hand.
---

Take $ARGUMENTS as an existing spec's path (conforming to `_template.md`), or
a rough idea to run through `/spec-new` first if no path is given — either
way this drives the same four stages the manual pipeline uses, just through
one entry point with worker parallelism added at the implement stage.

## Status narration: apply i-have-adhd

Apply i-have-adhd's output rules (action-first, numbered steps, no
preamble/recap/tangents, cap lists at 5) to status updates and progress
narration produced by this command — the pre-dispatch sanity check, per-wave
reporting, and step 5's budget tracking. Never apply them to escalation
writeups (step 3), contract-correction logs (step 3), or anything written to
a spec file, tracker entry, or verification-log entry (step 6) — those stay
complete regardless of active mode.

## 0. Don't force decomposition

This wraps the exact same loop `/spec-new` → `/spec-implement` →
`spec-verifier` → `/spec-archive` drive by hand — it never does anything a
human running each command separately couldn't. Use it when a spec is
genuinely large enough that worker parallelism earns back its own overhead.
Two cases where it doesn't, and the manual pipeline is the right call instead:

- A spec that's large but strictly sequential (each part depends on the
  previous part's output) stays a single `/spec-implement` run — waves exist
  for independent work, not for slicing up a linear one.
- A subspec small enough to just implement inline never gets its own worker.
  Dispatch overhead — a fresh worktree, a fresh subagent context, a
  wave-boundary sync point — isn't free, and isn't worth paying for a
  five-line change.

If it's genuinely unclear whether this spec is worth orchestrating at all,
say so and ask rather than defaulting to the heavier path.

## 1. Decompose into dependency-ordered waves

Read the spec's Implementation Details and Acceptance Criteria. Group the
work into subspecs, then order those subspecs into waves: everything in wave
N can be built with no dependency on anything not already finished in an
earlier wave. Two subspecs that would touch the same file, or where one's
contract depends on the other's actual output shape, can never share a wave
as independent workers — either serialize them into separate waves, or fold
them into a single worker's scope.

**Pre-dispatch sanity check.** Before launching wave 1, state the planned
wave count and worker count per wave, and why that shape fits the spec. This
is a check against runaway fan-out _before_ it happens — separate from, and
in addition to, the budget cap in step 5, which is the after-the-fact
backstop, not a replacement for looking before you leap.

## 2. Dispatch each wave

Per wave, launch one worker per subspec, each in its own isolated git
worktree — never the current working tree, and never a worktree shared with
another worker in the same wave. A worker never writes a file another worker
in the same wave owns; if two subspecs in the same wave would need to touch
the same file, that's a decomposition mistake from step 1 to fix, not
something to let both workers attempt and hope the diffs don't collide.

Follow the `subagent-dispatch` skill for how each worker's prompt is written
— model tiering, the explicit "unsure → flag it, don't act" escape hatch, and
keeping large scans out of the orchestrator's own context. Give each worker
its subspec's own scope, the parent spec's relevant Acceptance Criteria, and
the contract (function signatures, data shapes, file boundaries) it must
produce for downstream waves to build against — not the full parent spec
verbatim.

A fast System 1 decision model (e.g. Jev or Laya, if either is configured for
this project) may be used here for cheap, high-volume tiering/triage calls —
sizing a wave's worker count, classifying a subspec as mechanical vs.
judgment-required. Neither is required: a missing or failed call to either
must never block the run or degrade its outcome — the same tiering/triage
decision made on the orchestrator's own judgment, with neither configured,
must still land correctly.

## 3. Contract corrections vs. requirement escalation

If a later wave reveals an earlier wave's contract was wrong — a function
signature that doesn't fit how a downstream worker actually needs to call
it, a data shape missing a field another worker needs — that's the
orchestrator's own mistake to fix, not the parent spec's:

- Update the contract, never the parent spec's EARS Acceptance Criteria
  (those describe the requirement itself, not the orchestrator's translation
  of it into worker contracts).
- Re-dispatch every downstream worker the corrected contract affects.
- Log the correction explicitly — what was wrong, what changed, which
  workers were re-dispatched. Never patch around a bad contract silently.

If instead the problem traces back to a genuine misunderstanding of the
requirement itself — not a decomposition or contract mistake, but the spec
(or the brainstorm behind it) meant something other than what got built —
escalate to a human instead, exactly as Rule 3 (`04-ai-workflow-rules.md`)
already requires for any other unresolved ambiguity. Don't reinterpret the
requirement yourself and re-dispatch as though it were only a contract fix.

## 4. Verification — narrow, not exhaustive

Typecheck, tests, and build run as plain commands after each wave, at no LLM
cost. `spec-verifier`'s own job stays deliberately narrow here: confirm the
EARS Acceptance Criteria's test coverage actually matches what was claimed,
and read the diff for whatever genuinely isn't mechanically testable — the
same two-tier split `spec-verifier.md`'s "Comment/Formatting-Only Diffs"
section already uses for a single diff, extended here to the whole
orchestrated run. Don't have the verifier re-derive what a passing typecheck
already proved.

On FAIL: fix and re-verify, capped at two attempts total (same limit the
manual loop uses) before escalating to a human — never a third unsupervised
attempt.

## 5. Budget and default tiering

Track a token/time budget for the whole run. If it's exceeded, pause and
escalate to a human rather than continuing unsupervised — the after-the-fact
backstop behind step 1's before-the-fact sanity check, not a substitute for
it.

Starting-point model tiering per role — validate this empirically against
real runs, it's not a fixed rule:

- **Orchestrator** — Sonnet, high effort. The one serial, high-leverage step:
  a wrong decomposition corrupts every worker built against it, so this is
  not where to economize.
- **Workers** — Haiku. Mechanical, scoped implementation against an
  already-decided contract.
- **Verifier** — Sonnet, medium effort. Step 4's narrowed scope means less
  judgment work per pass than a from-scratch review.

If real runs show a role needs a stronger or cheaper model than this
starting point, that's exactly the kind of thing to flag via `/learn` once
there's real metrics (step 6) to back the change — not something to
adjust on a hunch mid-run.

## 6. Finish

Once the last wave passes verification, run `/spec-archive` on the parent
spec — the same finalization the manual pipeline already uses (condenses the
tracker entry, moves the spec to `docs/specs/archive/`).

Log this run's metrics — tokens, time, wave count, worker count, retries,
final verdict — into `docs/verification-log/` alongside the spec's own entry,
the same location the manual pipeline already writes to. This is what step
5's "validate empirically" and Rule 7's tooling-discovery capture actually
draw on later — a tiering adjustment or a captured skill with no metrics
behind it is a guess, not a finding.
