// Tests for `checks`: solution-style tsconfig detection, honest statuses
// (unknown is never a pass), base comparison, timeouts and parsers. Uses the
// real `tsc` from this package's own dependencies, linked into throwaway
// projects, so the false-pass bug is reproduced for real.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runChecks, parseTsc, parseEslintJson, parseBiomeJson, parseTestJson, usesProjectReferences } from '../checks.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TSC = path.resolve(HERE, '..', 'node_modules', 'typescript', 'bin', 'tsc');

async function project({ tsc = true, files }) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-checks-'));
  for (const [rel, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  }
  if (tsc) {
    await fs.mkdir(path.join(dir, 'node_modules', '.bin'), { recursive: true });
    await fs.symlink(TSC, path.join(dir, 'node_modules', '.bin', 'tsc'));
    await fs.mkdir(path.join(dir, 'node_modules', 'typescript'), { recursive: true });
  }
  return dir;
}

const SOLUTION = {
  'tsconfig.json': '{ "files": [], "references": [{ "path": "./tsconfig.app.json" }] }',
  'tsconfig.app.json': '{ "compilerOptions": { "strict": true, "composite": true, "noEmit": false, "emitDeclarationOnly": true, "outDir": "out" }, "include": ["src"] }',
};
const BAD = { 'src/a.ts': 'export const n: number = "not a number";\n' };
const GOOD = { 'src/a.ts': 'export const n: number = 1;\n' };
const opts = { skip: ['lint', 'tests'] };

test('usesProjectReferences: detects a solution-style tsconfig', () => {
  assert.equal(usesProjectReferences(SOLUTION['tsconfig.json']), true);
  assert.equal(usesProjectReferences('{ "compilerOptions": {} }'), false);
});

test('typecheck: a solution-style tsconfig with a type error FAILS (plain tsc --noEmit would exit 0)', async () => {
  const head = await project({ files: { ...SOLUTION, ...BAD } });
  const r = await runChecks({ head, ...opts });
  assert.equal(r.typecheck.tool, 'tsc -b');
  assert.equal(r.typecheck.status, 'fail');
  assert.equal(r.typecheck.errors, 1);
  assert.equal(r.typecheck.sample[0].code, 'TS2322');
});

test('typecheck: a clean solution-style project passes', async () => {
  const head = await project({ files: { ...SOLUTION, ...GOOD } });
  const r = await runChecks({ head, ...opts });
  assert.equal(r.typecheck.status, 'pass');
});

test('typecheck: a plain tsconfig uses tsc --noEmit', async () => {
  const head = await project({
    files: { 'tsconfig.json': '{ "compilerOptions": { "strict": true }, "include": ["src"] }', ...BAD },
  });
  const r = await runChecks({ head, ...opts });
  assert.equal(r.typecheck.tool, 'tsc --noEmit');
  assert.equal(r.typecheck.status, 'fail');
});

test('typecheck: no tsconfig is skipped, tsconfig without typescript installed is unknown', async () => {
  const none = await project({ tsc: false, files: { 'package.json': '{}' } });
  assert.equal((await runChecks({ head: none, ...opts })).typecheck.status, 'skipped');
  const noTool = await project({ tsc: false, files: { 'tsconfig.json': '{}' } });
  assert.equal((await runChecks({ head: noTool, ...opts })).typecheck.status, 'unknown');
});

test('typecheck: failures the base branch already has are labelled preexisting', async () => {
  const base = await project({ files: { ...SOLUTION, ...BAD } });
  const head = await project({ files: { ...SOLUTION, ...BAD } });
  const r = await runChecks({ head, base, ...opts });
  assert.equal(r.typecheck.status, 'preexisting');
  assert.equal(r.typecheck.baseErrors, 1);
});

test('typecheck: a clean base keeps a head failure as fail', async () => {
  const base = await project({ files: { ...SOLUTION, ...GOOD } });
  const head = await project({ files: { ...SOLUTION, ...BAD } });
  const r = await runChecks({ head, base, ...opts });
  assert.equal(r.typecheck.status, 'fail');
  assert.equal(r.typecheck.baseErrors, 0);
});

test('custom command: exit 0 passes, non-zero fails, output is sampled', async () => {
  const head = await project({ tsc: false, files: { 'package.json': '{}' } });
  const ok = await runChecks({ head, typecheckCmd: 'true', skip: ['lint', 'tests'] });
  assert.equal(ok.typecheck.status, 'pass');
  const bad = await runChecks({ head, testCmd: 'echo "3 tests failed"; exit 1', skip: ['lint', 'typecheck'] });
  assert.equal(bad.tests.status, 'fail');
  assert.match(bad.tests.sample[0], /3 tests failed/);
});

test('custom typecheck command: a non-zero exit with unparsable output is unknown, never pass', async () => {
  const head = await project({ tsc: false, files: { 'package.json': '{}' } });
  const r = await runChecks({ head, typecheckCmd: 'echo boom; exit 2', skip: ['lint', 'tests'] });
  assert.equal(r.typecheck.status, 'unknown');
});

test('timeout: a command that outlives the limit is unknown', async () => {
  const head = await project({ tsc: false, files: { 'package.json': '{}' } });
  const r = await runChecks({ head, testCmd: 'sleep 5', skip: ['lint', 'typecheck'], timeoutMin: 0.01 });
  assert.equal(r.tests.status, 'unknown');
  assert.match(r.tests.note, /timed out/);
});

test('tests: a package.json test script is used when no runner is listed; none at all is skipped', async () => {
  const withScript = await project({ tsc: false, files: { 'package.json': '{ "scripts": { "test": "exit 1" } }' } });
  assert.equal((await runChecks({ head: withScript, skip: ['lint', 'typecheck'] })).tests.status, 'fail');
  const none = await project({ tsc: false, files: { 'package.json': '{}' } });
  assert.equal((await runChecks({ head: none, skip: ['lint', 'typecheck'] })).tests.status, 'skipped');
});

test('lint: nothing lintable is skipped; a config without the tool installed is unknown', async () => {
  const head = await project({ tsc: false, files: { 'eslint.config.js': 'export default [];', 'src/a.ts': 'x' } });
  assert.equal((await runChecks({ head, files: ['README.md'], skip: ['typecheck', 'tests'] })).lint.status, 'skipped');
  const r = await runChecks({ head, files: ['src/a.ts'], skip: ['typecheck', 'tests'] });
  assert.equal(r.lint.status, 'unknown');
});

test('parsers: tsc, eslint, biome and test JSON', () => {
  assert.equal(parseTsc("src/a.ts(1,2): error TS2322: bad\nerror TS5083: cannot read file").errors, 1);
  assert.equal(parseTsc("error TS5083: cannot read file").other, 1);
  assert.deepEqual(parseEslintJson('[{"filePath":"a","messages":[{"severity":2,"line":1,"ruleId":"r","message":"m"},{"severity":1}]}]').errors, 1);
  assert.equal(parseEslintJson('nope'), null);
  assert.equal(parseBiomeJson(JSON.stringify({ summary: { errors: 2, warnings: 1 }, diagnostics: [{ severity: 'error', category: 'lint/x', message: 'm', location: { path: 'a', start: { line: 3 } } }] })).errors, 2);
  assert.equal(parseTestJson(JSON.stringify({ numTotalTests: 2, numPassedTests: 1, numFailedTests: 1, testResults: [{ assertionResults: [{ status: 'failed', fullName: 'x', failureMessages: ['boom\nstack'] }] }] })).sample[0].message, 'boom');
  assert.equal(parseTestJson('{}'), null);
});
