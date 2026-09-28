// Real worktree add/remove and ref create/delete against a throwaway repo —
// the same sequence validated by hand while building this package
// (checkout -> confirm node_modules symlink + .env copy -> dispose ->
// confirm clean removal -> refs-delete -> confirm no refs remain).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { checkout, dispose, refsDelete } from '../checkout.mjs';
import { run } from '../lib/proc.mjs';
import { makeTmpRepo, writeFileDeep, commitAll, cleanup } from './lib/tmp-repo.mjs';

let repo;
let sha;
let worktreeDir;

before(async () => {
  repo = await makeTmpRepo();
  await writeFileDeep(repo, 'src/index.ts', 'export const ok = true;\n');
  sha = await commitAll(repo, 'initial');

  // node_modules and .env are deliberately created AFTER the commit and
  // never git-added — in a real repo neither is tracked, and checkout's
  // whole job is to bring them into the worktree some other way (symlink,
  // copy) precisely because a plain `git worktree add` would leave them out.
  await writeFileDeep(repo, '.env', 'API_KEY=fake\n');
  await fs.mkdir(path.join(repo, 'node_modules'), { recursive: true });
  await writeFileDeep(repo, 'node_modules/.marker', 'x');
  worktreeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-worktree-'));
  await fs.rmdir(worktreeDir); // worktree add requires the dir not exist yet
});

after(async () => {
  await cleanup(repo);
  await cleanup(worktreeDir);
});

function captureLog(fn) {
  const logs = [];
  const restore = console.log;
  console.log = (line) => logs.push(line);
  return fn()
    .then(() => logs)
    .finally(() => {
      console.log = restore;
    });
}

test('checkout: adds a worktree, symlinks node_modules, and copies .env', async () => {
  const logs = await captureLog(() => checkout({ repo, ref: sha, dir: worktreeDir }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.ok, true);
  assert.equal(result.linkedNodeModules, true);
  assert.deepEqual(result.envFiles, ['.env']);

  const link = await fs.lstat(path.join(worktreeDir, 'node_modules'));
  assert.equal(link.isSymbolicLink(), true);
  const target = await fs.readlink(path.join(worktreeDir, 'node_modules'));
  assert.equal(path.resolve(path.dirname(path.join(worktreeDir, 'node_modules')), target), path.join(repo, 'node_modules'));

  const envContent = await fs.readFile(path.join(worktreeDir, '.env'), 'utf8');
  assert.equal(envContent, 'API_KEY=fake\n');
});

test('dispose: unlinks the node_modules symlink before removing the worktree, leaving the repo\'s real node_modules untouched', async () => {
  await captureLog(() => dispose({ repo, dir: worktreeDir }));

  const worktreeList = await run('git', ['worktree', 'list'], { cwd: repo });
  assert.ok(!worktreeList.stdout.includes(worktreeDir), 'worktree should be removed from the list');

  const marker = await fs.readFile(path.join(repo, 'node_modules', '.marker'), 'utf8');
  assert.equal(marker, 'x', 'the real node_modules must survive dispose');
});

test('refs-delete: removes every refs/pr-review/<pr>/* ref this tool created', async () => {
  await run('git', ['update-ref', 'refs/pr-review/99/head', sha], { cwd: repo });
  await run('git', ['update-ref', 'refs/pr-review/99/base', sha], { cwd: repo });

  const before = await run('git', ['show-ref'], { cwd: repo });
  assert.ok(before.stdout.includes('refs/pr-review/99'));

  await captureLog(() => refsDelete({ repo, pr: 99 }));

  const afterResult = await run('git', ['show-ref'], { cwd: repo });
  assert.ok(!afterResult.stdout.includes('refs/pr-review/99'));
});
