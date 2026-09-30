// `triage`: classifies every changed file, excludes noise from the
// reviewable line count, buckets the PR into a size tier, and picks which
// units get a full ("deep") read vs. a capped ("skimmed") one. See
// README.md's "Size tiers" section for the exact thresholds and ranking.

import path from 'node:path';
import fs from 'node:fs/promises';
import { nameStatus, numstat } from './lib/git.mjs';
import { isNoise, fileKind, unitKey, isSensitive } from './lib/classify.mjs';

const TIERS = [
  { name: 'S', max: 400 },
  { name: 'M', max: 2000 },
  { name: 'L', max: 10000 },
  { name: 'XL', max: Infinity },
];

// How many reviewable lines get a full "deep" read before the rest of an
// L/XL PR's units fall back to "skimmed". S/M PRs are small enough that
// every unit is deep regardless.
const DEEP_READ_BUDGET = 3000;

function tierFor(reviewableLines) {
  return TIERS.find((t) => reviewableLines <= t.max).name;
}

export async function triage(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const { from, to, out } = args;
  if (!from || !to || !out) {
    console.error('triage requires --repo --from --to --out');
    process.exitCode = 1;
    return;
  }

  const entries = await nameStatus(repo, from, to);
  const lineCounts = await numstat(repo, from, to);
  const wsLineCounts = await numstat(repo, from, to, ['--ignore-all-space']);

  const linesByPath = new Map(lineCounts.map((e) => [e.path, e.additions + e.deletions]));
  const wsLinesByPath = new Map(wsLineCounts.map((e) => [e.path, e.additions + e.deletions]));

  const files = entries.map((entry) => {
    const lines = linesByPath.get(entry.path) ?? 0;
    const wsLines = wsLinesByPath.get(entry.path) ?? lines;
    const whitespaceOnly = lines > 0 && wsLines === 0;
    const kind = fileKind(entry.path);
    const noise = isNoise(entry, { whitespaceOnly });
    return {
      path: entry.path,
      status: entry.status,
      kind,
      lines,
      sensitive: isSensitive(entry.path),
      noise,
    };
  });

  const reviewableLines = files.filter((f) => !f.noise).reduce((sum, f) => sum + f.lines, 0);
  const tier = tierFor(reviewableLines);

  // Group non-noise files into units, then rank units by (sensitive, lines).
  const unitsByKey = new Map();
  for (const f of files) {
    if (f.noise) continue;
    const key = unitKey(f.path);
    if (!unitsByKey.has(key)) unitsByKey.set(key, { key, files: [], lines: 0, sensitive: false });
    const unit = unitsByKey.get(key);
    unit.files.push(f.path);
    unit.lines += f.lines;
    unit.sensitive = unit.sensitive || f.sensitive;
  }

  const ranked = [...unitsByKey.values()].sort((a, b) => {
    if (a.sensitive !== b.sensitive) return a.sensitive ? -1 : 1;
    return b.lines - a.lines;
  });

  const deep = [];
  const skimmed = [];

  if (tier === 'S' || tier === 'M') {
    deep.push(...ranked);
  } else {
    let budget = DEEP_READ_BUDGET;
    for (const unit of ranked) {
      if (budget > 0) {
        deep.push(unit);
        budget -= unit.lines;
      } else {
        skimmed.push(unit);
      }
    }
  }

  const excludedFiles = files.filter((f) => f.noise);

  const result = {
    from,
    to,
    tier,
    reviewableLines,
    totalFiles: files.length,
    excludedFileCount: excludedFiles.length,
    files,
    units: {
      deep: deep.map((u) => ({ key: u.key, files: u.files, lines: u.lines, sensitive: u.sensitive })),
      skimmed: skimmed.map((u) => ({ key: u.key, files: u.files, lines: u.lines, sensitive: u.sensitive })),
    },
  };

  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await fs.writeFile(path.resolve(out), JSON.stringify(result, null, 2));

  console.log(
    [
      `tier: ${tier} (${reviewableLines} reviewable lines)`,
      `deep units: ${deep.length}`,
      `skimmed units: ${skimmed.length}`,
      `excluded files: ${excludedFiles.length}`,
      `changed files: ${files.length}`,
    ].join('\n')
  );
}
