// `diff` — a compact unified diff for one triage unit, reviewable files
// only. See README.md's "diff" section.

import path from 'node:path';
import { nameStatus, unifiedDiff } from './lib/git.mjs';
import { isNoise, unitKey } from './lib/classify.mjs';

export async function diff(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const { from, to, unit } = args;
  if (!from || !to || !unit) {
    console.error('diff requires --repo --from --to --unit');
    process.exitCode = 1;
    return;
  }

  const entries = await nameStatus(repo, from, to);
  const paths = entries
    .filter((e) => !isNoise(e) && unitKey(e.path) === unit)
    .map((e) => e.path);

  if (paths.length === 0) {
    console.log(JSON.stringify({ unit, files: [], diff: '', truncated: false }));
    return;
  }

  const raw = await unifiedDiff(repo, from, to, paths, 2);
  const max = args.max ? Number.parseInt(args.max, 10) : null;

  let text = raw;
  let truncated = false;
  if (max) {
    const lines = raw.split('\n');
    if (lines.length > max) {
      text = `${lines.slice(0, max).join('\n')}\n… (truncated at ${max} lines; ${lines.length - max} more)`;
      truncated = true;
    }
  }

  console.log(JSON.stringify({ unit, files: paths, diff: text, truncated }));
}
