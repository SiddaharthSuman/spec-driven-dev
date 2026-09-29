# Text hygiene: plain ASCII in code files

This covers code and config files that ship functionality: JS and TS, JSON,
CSS, YAML, TOML, shell, HTML. Markdown and `.txt` files are exempt. Commit
messages follow the same plain-text rules.

## Contents

- Rules
- What the sanitizer fixes and what it reports
- Enforcement layers
- Exceptions

## Rules

- **No em or en dashes.** Rephrase the sentence so it reads well without one.
  Do not swap in a hyphen, which hides the tell without fixing the sentence.
- **Straight quotes only**, single or double. No curly quotes. Three dots, not
  the ellipsis character.
- **No markdown asterisks or heading hashes** in code comments or string values.
- **No non-ASCII characters:** no arrows, check marks, accented letters,
  lookalike letters from other alphabets, non-breaking or zero-width spaces.
- **No trailing whitespace.**

## What the sanitizer fixes and what it reports

`node ${CLAUDE_PLUGIN_ROOT}/sanitize/sanitize.mjs <files>` fixes what is
mechanical: hidden characters, unusual spaces, lookalike letters, curly quotes
in comments and strings (escaped correctly), the ellipsis character, trailing
whitespace, markdown markers in comments, Unicode normalization form.

It only reports what needs a person: dashes and any other non-ASCII character,
with file, line and U+ code point. Add `--check` to report without writing,
`--staged` for the git index. `--hook` is the PostToolUse mode.

## Enforcement layers

Hooks are not guaranteed to fire everywhere (subagents, git worktrees), so
enforcement is layered:

1. **Worker self-check.** Before every commit a worker runs the sanitizer on its
   changed files, fixes every reported line by hand, then commits.
2. **Orchestrator check** on each worker's worktree diff (step 5). Always runs,
   whatever the hooks do.
3. **PostToolUse hook** (`hooks.json`): feedback after each Write or Edit, best
   effort. After it rewrites a file, re-read the file before the next Edit on
   it or the old text will not match.
4. **Git pre-commit hook** in the repo: `sanitize.mjs --check --staged` from a
   vendored copy at `scripts/sanitize.mjs`. It blocks the commit in the main
   tree. Husky 9's default hooks directory is generated and ignored, so it does
   not exist in new worktrees and the hook does not fire there unless
   `core.hooksPath` points at a tracked or absolute path. Layers 1 and 2 cover
   workers either way.
5. **Full gate** (step 7): `--check` over every changed file.

## Exceptions

For an intentional exception, such as a Unicode test fixture, put the ignore
marker in a comment within the first 5 lines of the file (see the header of
`sanitize.mjs`), or list the path in `.sanitizeignore`.
