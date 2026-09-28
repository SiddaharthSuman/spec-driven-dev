---
description:
  Propose a correction to the context docs — or a new enforcement hook — after
  something surprised you.
---

Something in `docs/context/` was wrong, missing, or misleading — or you (or
someone you were watching) just made a mistake that a doc fix alone won't
prevent next time. Write up:

1. **What happened** — what the docs said, or failed to say, versus what was
   actually true.
2. **Is this new, or recurring?** Check whether this same category of mistake
   has already been flagged via `/learn` before — prior doc corrections in
   `docs/context/` covering the same pattern, or past conversation/commit
   history mentioning it.
   - **First occurrence** → propose a diff against the relevant
     `docs/context/` file, as usual. Output the diff and stop for human
     review; don't edit the file yourself.
   - **Recurring** (flagged via `/learn` more than once) → a doc fix alone
     hasn't been enough. Propose a new enforcement hook instead of, or
     alongside, the doc fix. Hooks live under `.claude/hooks/` — create that
     directory if this is the first one. The proposal needs:
     - **Pattern** — exactly what it detects, made concrete (e.g. a
       service-layer bypass, a banned import, a naming violation).
     - **Stage** — `pre-commit` or `pre-push`, and why that stage fits.
     - **Script** — a draft of the actual check, in whatever this repo's
       tooling already uses, plus the failure message it should show.
3. Output the proposed diff and/or hook script for a human to review and
   apply. Don't edit files, create the hooks directory, or install anything
   yourself — this command only produces output for review.
