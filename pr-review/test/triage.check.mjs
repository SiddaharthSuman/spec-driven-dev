// Builds a real 2-commit git repo (source edit + a touched lockfile) and
// runs the real `triage` module against it — the same scenario validated
// by hand against /tmp/fake-repo while building this package, now codified.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { triage } from '../triage.mjs';
import { makeTmpRepo, writeFileDeep, commitAll, cleanup } from './lib/tmp-repo.mjs';

let repo;
let baseSha;
let headSha;
let outPath;

before(async () => {
  repo = await makeTmpRepo();
  await writeFileDeep(repo, 'pnpm-lock.yaml', 'lockfileVersion: 5\n');
  await writeFileDeep(repo, 'src/features/invoices/filters.ts', 'export function ok() { return true; }\n');
  baseSha = await commitAll(repo, 'initial');

  await writeFileDeep(
    repo,
    'src/features/invoices/filters.ts',
    'export function validateDateRange(a, b) {\n  return a && b;\n}\n'
  );
  await writeFileDeep(repo, 'pnpm-lock.yaml', 'lockfileVersion: 5\nfoo: bar\n');
  headSha = await commitAll(repo, 'add validator');

  outPath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-out-')), 'triage.json');
});

after(async () => {
  await cleanup(repo);
  await cleanup(path.dirname(outPath));
});

test('triage: excludes the lockfile from reviewable lines and picks it up as noise', async () => {
  await triage({ repo, from: baseSha, to: headSha, out: outPath });
  const result = JSON.parse(await fs.readFile(outPath, 'utf8'));

  const lockfile = result.files.find((f) => f.path === 'pnpm-lock.yaml');
  assert.ok(lockfile, 'lockfile should still be listed');
  assert.equal(lockfile.noise, true);

  const source = result.files.find((f) => f.path === 'src/features/invoices/filters.ts');
  assert.equal(source.noise, false);
  assert.equal(source.kind, 'source');

  // Only the source file's lines count toward reviewableLines.
  assert.equal(result.excludedFileCount, 1);
  assert.ok(result.reviewableLines > 0);
  assert.equal(result.reviewableLines, source.lines);
});

test('triage: a small diff like this lands in size tier S with every unit deep', async () => {
  await triage({ repo, from: baseSha, to: headSha, out: outPath });
  const result = JSON.parse(await fs.readFile(outPath, 'utf8'));

  assert.equal(result.tier, 'S');
  assert.equal(result.units.skimmed.length, 0);
  assert.ok(result.units.deep.length >= 1);
  assert.deepEqual(result.units.deep[0].files, ['src/features/invoices/filters.ts']);
});
