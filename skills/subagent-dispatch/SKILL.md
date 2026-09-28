---
name: subagent-dispatch
description:
  How to dispatch parallel subagents efficiently for mechanical, multi-file
  specs (doc/comment passes, renames, boilerplate scaffolding, repetitive
  migrations). Covers model selection (mechanical vs. judgment-required work),
  avoiding orchestrator context bloat from large diffs/scans, and context
  checkpointing around fan-out and verification. Use whenever a spec will be
  implemented via more than one subagent, or whenever the user asks to
  parallelize, speed up, or "make this faster" for a multi-file task — even if
  they never say "subagents" outright.
---

# Subagent Dispatch

This skill is about planning *how* to run a multi-subagent spec, not what any
one subagent should actually do. Consult it before dispatching subagents for a
spec that touches many files with the same repeated change.

## When this applies

- The spec repeats the same kind of edit across many files — comment passes,
  renaming, scaffolding, config migrations.
- The user asks to parallelize something, or the task naturally partitions by
  file/feature area with no cross-file conflicts.
- **Doesn't apply** to a single-agent implementation of one cohesive feature —
  that's ordinary spec work, not this.

## Core principle: split by judgment, not by file count

The axis that matters is mechanical vs. judgment-required, not "how many
files." Splitting purely by feature area gives you parallelism, but if every
subagent defaults to the same model regardless of how much judgment its slice
actually needs, you've fixed only half the problem:

- **Mechanical subagents** (add a comment, rename a symbol, apply a fixed
  template) → dispatch on a cheaper model (e.g. `model: "haiku"` on the
  `Agent`/Task call). `model` is set per invocation, not baked into the agent
  definition — the same `general-purpose` agent type can run cheap for
  mechanical work and frontier for anything requiring judgment, within the
  same session.
- **Judgment-required subagents** (a spec-verifier judging accuracy rather
  than mere presence, anything resolving ambiguity, anything weighing
  trade-offs) → keep these on Sonnet/Opus.
- **Cheap doesn't mean risk-free.** A cheap model is if anything *more* likely
  to quietly drift outside scope — "helpfully" reformatting a line while
  adding a comment — precisely because it isn't reasoning carefully about the
  constraint. Give every mechanical-subagent prompt an explicit escape hatch:
  "if you're unsure whether a change is in scope, don't make it — flag it
  instead."
- **Verify for usefulness, not just correctness.** A cheap-model comment pass
  can be technically accurate and still useless ("Handles the request"). A
  pass/fail diff check won't catch that — sample a handful of outputs
  specifically for whether they're actually useful, not merely in scope.

## Don't let the orchestrator read what a subagent already checked

Large scans — multi-thousand-line diffs, whole-tree greps, full test output —
don't need to live in the orchestrating session's context once a subagent has
already processed them. Delegate the scan, have it return a short verdict plus
a small sample, not the raw output. Reading an 18,000-line diff directly into
the main thread is pure context cost with no benefit once a subagent has
already confirmed the result.

## Checkpoint the context, don't let it run continuously

Two natural points to `/compact` at, rather than mid-task:

1. **Right after fan-out completes**, before verification starts — the
   dispatch instructions and individual subagent transcripts aren't needed
   once they've reported back.
2. **Right after the first verifier pass**, before any fix-up round —
   fix-up subagents only need the specific list of flagged issues, not the
   verifier's full scan.

Also collapse repeated polling into one longer wait (or rely on the
completion notification) rather than stacking several short `ScheduleWakeup`
heartbeats over one wait — each is cheap alone, but they add up across a
long-running fan-out.

## Quick checklist before dispatching

- [ ] Partitioned by non-overlapping files (feature area, directory, or
      similar)?
- [ ] Each subagent's task classified mechanical or judgment-required, with
      model set accordingly?
- [ ] Mechanical prompts include an explicit "unsure → don't act, flag it"
      instruction?
- [ ] Large scans delegated to a subagent that returns a verdict, not raw
      output, to the orchestrator?
- [ ] `/compact` planned at fan-out-complete and verifier-pass-complete?
- [ ] Verification checks usefulness/accuracy of a sample, not just
      presence/pass-fail?
