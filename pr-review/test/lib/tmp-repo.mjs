// Shared helper for tests that need a real, throwaway git repo rather than
// a mocked one: triage/diff/checkout all shell out to real `git`, so a
// fixture repo on disk is what actually exercises them.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runOrThrow } from '../../lib/proc.mjs';

export async function makeTmpRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-test-'));
  await runOrThrow('git', ['init', '-q', '-b', 'main'], { cwd: dir });
  await runOrThrow('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  await runOrThrow('git', ['config', 'user.name', 'Test'], { cwd: dir });
  return dir;
}

export async function writeFileDeep(repo, relPath, content) {
  const abs = path.join(repo, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content);
}

export async function commitAll(repo, message) {
  await runOrThrow('git', ['add', '-A'], { cwd: repo });
  await runOrThrow('git', ['commit', '-q', '-m', message], { cwd: repo });
  const sha = await runOrThrow('git', ['rev-parse', 'HEAD'], { cwd: repo });
  return sha.trim();
}

export async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}
