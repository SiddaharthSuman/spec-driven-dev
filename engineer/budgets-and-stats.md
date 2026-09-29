# Budgets, model ceiling, and run statistics

## Contents

- Budget tables
- When a budget is exhausted
- Model ceiling and consent
- Under budget and cause tags
- Recording statistics
- Reading past runs

## Budget tables

A budget is a size class multiplied by a role multiplier. The `budgets`
command does the arithmetic, so these tables are reference and every number is
a starting guess. Once `docs/verification-log/budget-calibration.json` holds 3
samples for a size, tier and effort, the command uses the measured median plus
25 percent instead.

**Size class** (base minutes at the fast tier, low effort):

| Class | Scope                           | Base |
| ----- | ------------------------------- | ---- |
| XS    | 1 file, up to 2 criteria        | 3    |
| S     | up to 3 files, up to 4 criteria | 6    |
| M     | up to 5 files, up to 6 criteria | 10   |

Anything larger than M is split, or the plan says why it cannot be.

**Role multiplier** (tier by effort):

| Tier                    | Low | Medium | High |
| ----------------------- | --- | ------ | ---- |
| Fast (Haiku)            | 1.0 | 1.25   | 1.5  |
| Mid (Sonnet)            | 1.5 | 2.0    | 3.0  |
| Strong (Opus and above) | 2.5 | 3.5    | 5.0  |

**Derived budgets:**

- Worker: size base x the worker's multiplier.
- Verifier per worker: 3 min x the verifier's multiplier.
- Wave: longest worker + longest verifier + measured per-wave gate + 2 min merge.
- Planning (steps 1 to 3, including the micro-spec review): 10 min x the
  orchestrator's multiplier for up to 5 subspecs, plus 2 min x the multiplier
  per extra subspec.
- Whole run: planning + every wave + measured full gate + final verifier + 3
  min archive.

`subspec-plan` fields: `id wave size model effort files criteria`.

## When a budget is exhausted

The agent justifies it and the spec is revisited. The worker's Budget Report
says why time ran out. The orchestrator, or whoever wrote the spec, revisits the
micro-spec using that report: was the scope misjudged, a dependency missed, the
size class or multiplier wrong? Then it decides: extend with the reason
recorded, split, rewrite, retry with a different model, or escalate. Splitting
is one option, not a rule. As a safety net the orchestrator stops any worker at
2x its budget and asks for the same report from what it has committed.

If the whole-run budget is exceeded, pause and escalate to a human. It is the
after-the-fact backstop behind step 0's verdict, not a substitute for it.

## Model ceiling and consent

A retry, or any other role, never uses a model stronger than the orchestrator's
own. Check with `engineer-stats.mjs tier-check orchestrator=<m> requested=<m>`.
If the orchestrator's model is itself not enough, stop and take the proposal to
the human: which role, which model, why, and roughly how much more usage it
costs. Use nothing stronger until they agree, then record the answer with a
`consent` event. This also applies to upgrading the orchestrator itself.
Expensive models drain the usage quota quickly, so this is a hard gate.

## Under budget and cause tags

When a worker finishes well under half its budget, the budget maker checks how
it was set: was the subspec smaller than its class, or is the multiplier too
generous for this model and effort? Record a one-line finding in the wave
report. This is not a failure. A verifier PASS is the independent evidence that
speed did not cost quality.

Every wave over or under budget gets `cause=` on its `wave-end` event, from a
fixed set so runs compare cleanly: `scope-too-big`, `contract-gap`,
`dependency-gap`, `worker-retry`, `verifier-fail`, `gate-slow`,
`orchestrator-wait`, `budget-generous`, `other` (explain in the wave report).

## Recording statistics

Run `engineer-stats.mjs event <type> --run <slug> k=v ...` at each point below.
Timestamps are automatic. If the harness reports a subagent's duration or
tokens, pass `duration_ms=` or `tokens=` and those are used instead.

| Event                             | When                                                                      |
| --------------------------------- | ------------------------------------------------------------------------- |
| `planning-start` / `planning-end` | around steps 1 to 3                                                       |
| `wave-start` / `wave-end`         | wave begins / all its workers are verified and merged                     |
| `worker-start` / `worker-end`     | worker launched / returns (`status=done\|blocked\|budget-report\|failed`) |
| `verify-start` / `verify-end`     | verifier launched / returns (`verdict=PASS\|FAIL`)                        |
| `gate-start` / `gate-end`         | around every gate run (`name=`)                                           |
| `blocked`                         | a BLOCKED report arrives (`id=`, `missing=`)                              |
| `unplanned`                       | a file outside the tree was changed (`file=`)                             |
| `consent`                         | the human answers a model proposal (`role from to decision`)              |

A re-dispatched worker just gets another `worker-start`. The record counts
attempts and sums time.

The `finish` output holds what a person wants to check later: planned against
actual time and percentage error for planning, each wave, each worker and the
whole run; model and effort per worker; attempts; BLOCKED reports; verifier
time and verdict; gate times; tokens; unplanned files; consent decisions.

## Reading past runs

At planning time, read the latest few `docs/verification-log/*.run-stats.md`.
The mean absolute error line shows how good the last predictions were, and the
flagged workers show where budgets were too tight or too generous.
