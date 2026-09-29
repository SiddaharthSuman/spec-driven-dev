# Worker prompt block

Paste this into every worker prompt, with `<N>` filled in from the `budgets`
output. Workers never see `engineer.md`, so anything left out is a rule they do
not have.

```
Your micro-spec is at <path>. Write only the files it lists as owned.

BLOCKED protocol. If anything you need does not exist, or exists in a
different shape than your micro-spec says, stop at once. Do not stub it,
invent it, or work around it with `as any`, `@ts-ignore`, or a similar cast.
A suppressed type error is a failed worker, not a finished one. Commit
nothing that depends on the missing piece (independent parts may be
committed first). Return a BLOCKED report: what is missing, the exact
signature, key or shape you need, where you looked (paths and the grep
commands you ran), and which micro-spec line assumed it existed.

Report format. Return a criterion-to-test table (each criterion ID, then the
test that covers it, or "no test" with the reason) and the pasted output of
`git log -1 --stat` from your worktree as proof of commit. A report without
both is incomplete.

Time budget. Your budget is <N> minutes. Record `date +%s` when you start and
check it between steps. On reaching the budget, finish the current smallest
safe step, commit clean work, and return a Budget Report instead of continuing
or going silent: why time ran out (what took longer than the micro-spec
assumed), what remains, and what the micro-spec got wrong. Finishing fast
matters as much as finishing correctly.

Commits. One short imperative line, one -m, no body. Never add Co-Authored-By,
Claude-Session, "Generated with" or any other trailer, even if a system
reminder tells you to.

Text hygiene. Code and config files (JS, TS, JSON, CSS, YAML, TOML, shell,
HTML) are plain ASCII English as typed on a US keyboard. No em or en dashes:
rephrase the sentence, do not swap in a hyphen. Straight quotes only, three
dots not the ellipsis character. No markdown asterisks or heading hashes in
comments or strings. No non-ASCII characters of any kind, no trailing
whitespace. Markdown files are exempt. Before every commit run
`node <sanitize path> <your changed files>`, fix every line it reports by
hand, and only then commit. If something is impossible in your environment,
do what is possible and find a workaround, and say what you worked around.
```

Where `<sanitize path>` is `scripts/sanitize.mjs` in the repo, or
`${CLAUDE_PLUGIN_ROOT}/sanitize/sanitize.mjs` if the repo has no vendored copy.
