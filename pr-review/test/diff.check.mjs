import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { unitKey } from '../lib/classify.mjs';
import { diff } from '../diff.mjs';
import { makeTmpRepo, writeFileDeep, commitAll, cleanup } from './lib/tmp-repo.mjs';

let repo;
let baseSha;
let headSha;
let logs;
let restoreLog;

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
});

after(async () => {
  await cleanup(repo);
});

function captureLog(fn) {
  logs = [];
  restoreLog = console.log;
  console.log = (line) => logs.push(line);
  return fn().finally(() => {
    console.log = restoreLog;
  });
}

test('diff: only includes files in the requested unit, and never the lockfile', async () => {
  const unit = unitKey('src/features/invoices/filters.ts');
  await captureLog(() => diff({ repo, from: baseSha, to: headSha, unit }));

  const result = JSON.parse(logs[0]);
  assert.deepEqual(result.files, ['src/features/invoices/filters.ts']);
  assert.ok(result.diff.includes('validateDateRange'));
  assert.ok(!result.diff.includes('lockfileVersion'));
});

test('diff: a unit with no matching changed files returns an empty diff, not an error', async () => {
  await captureLog(() => diff({ repo, from: baseSha, to: headSha, unit: 'src/nonexistent' }));
  const result = JSON.parse(logs[0]);
  assert.deepEqual(result.files, []);
  assert.equal(result.diff, '');
});

test('diff: --max truncates long output and reports truncated:true', async () => {
  const unit = unitKey('src/features/invoices/filters.ts');
  await captureLog(() => diff({ repo, from: baseSha, to: headSha, unit, max: '2' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.truncated, true);
  assert.ok(result.diff.includes('truncated at 2 lines'));
});
