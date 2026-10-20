# Serial mode: text for a project's 04-ai-workflow-rules.md

Paste the section below into each project's `docs/context/04-ai-workflow-rules.md`
after the "Orchestrated implementation (`/engineer`)" section, and apply the two
small edits listed under it. The same wording is in the plugin README's
bootstrap prompt, so new projects get it. The behavior itself lives in the
plugin (`commands/spec-implement-serial.md`, `serial/serial-run.md`), not in
the project.

## Section to add

```
## Serial implementation (`/spec-implement-serial`)

Run by name, never chosen by `/engineer`. Takes one or more specs and works
them one at a time, unattended.

24. **Vocabulary.** A spec is cut into ordered *levels*, each built on the
    previous level's branch (the *stack*, level 1 at the bottom). Finished
    levels are *folded* back into level 1, which becomes the spec's branch.
    A run opens no pull request and never pushes. Rules 15 to 22 describe
    parallel *waves*; the two words are not interchangeable.
25. **Unattended means no human step.** Where another rule says "escalate to a
    human" or "stop and ask", a serial run repairs automatically within its
    failure loop, or *parks*: every branch is preserved, nothing is archived,
    the queue halts, and a park report is written. Rerunning the command
    resumes at the failed level.
26. **Three gates.** Each level passes a build gate (typecheck, tests,
    sanitizer, a fresh verifier on its micro-spec) before the next level is
    cut. The fold gate is mechanical (ancestry, fast-forward, typecheck and
    tests). The final gate is the full gate plus a final `spec-verifier` on
    the parent spec.
27. **Repair, then record.** A failure is repaired by re-evaluating the
    micro-spec, finding the gap across the whole stack, fixing where the cause
    lives (restacking the levels above), and verifying with a fresh agent,
    twice at most per level. Only a repaired failure is recorded, in
    `docs/verification-log/serial-lessons.md`. A repeated category produces a
    written proposal in `serial-proposals.md`, never an installed hook, and
    rule 4 still forbids weakening a test to make a fix pass.
28. **Independent specs, chained only on a hard need.** Each spec in a queue
    starts from the default branch. The run finds dependencies itself: spec B
    depends on spec A only when something B needs exists nowhere in the repo
    and only A creates it. Sharing a file is never a dependency. The run
    orders specs by dependency, cuts a dependent spec from its provider's
    branch, parks on a cycle or on a needed spec that is neither in the run
    nor implemented, and has a fresh agent review the graph. `after=<path>`
    can add a dependency the run cannot see. The person then merges in order,
    and restacks with the recipes in the plugin if a merge strategy rewrites
    history.
```

## Edits to existing rules

- Rules 15 to 22: add the heading "Orchestrated implementation (`/engineer`),
  parallel waves" and a line saying rule 22 (text hygiene in layers) also
  applies to serial mode.
- Rule 13 (`/learn`): add "A serial run records its own repaired failures
  automatically (rule 27); `/learn` is still run by a person."
