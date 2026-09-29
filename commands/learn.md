---
description:
  Propose a correction to the context docs, or a new enforcement mechanism,
  after something surprised you.
---

Something in `docs/context/` was wrong, missing, or misleading, or you (or
someone you were watching) just made a mistake that a doc fix alone won't
prevent next time. Write up:

1. **What happened.** What the docs said, or failed to say, versus what was
   actually true.
2. **Is this new, or recurring?** Check whether this same category of mistake
   has already been flagged via `/learn` before: prior doc corrections in
   `docs/context/` covering the same pattern, or past conversation and commit
   history mentioning it.
   - **First occurrence:** propose a diff against the relevant
     `docs/context/` file. Output the diff and stop for human review. Don't
     edit the file yourself.
   - **Recurring** (flagged more than once): a doc fix alone hasn't been
     enough. Propose an enforcement mechanism instead of, or alongside, the
     doc fix. First decide where the mistake actually happens, because the
     two locations are different and must never be assumed to be one:
     - **Agent-side** (an agent made the mistake while editing or running
       tools): a Claude Code hook. Hooks live in the spec-driven-dev plugin
       (`hooks/hooks.json` plus a script), not in this repo, so the proposal
       is for the plugin maintainer to apply there. Give the `hooks.json` entry
       (event and matcher), the script, and the message it shows the agent.
     - **Human-edit-side** (a person's commit or push introduced it): a Husky
       script in this repo's `.husky/`. Give the stage (`pre-commit` or
       `pre-push`) and why it fits, the script, and the failure message.
     - **Both:** propose both, each in its own location.

     Either way the proposal needs:
     - **Pattern:** exactly what it detects, made concrete (a service-layer
       bypass, a banned import, a naming violation).
     - **Script:** a draft of the actual check, in whatever this repo's
       tooling already uses, plus the failure message it should show.

3. Output the proposed diff and/or script for a human to review and apply.
   Don't edit files, create hook directories, or install anything yourself.
   This command only produces output for review.
