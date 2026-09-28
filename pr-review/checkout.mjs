// `checkout` / `dispose` / `refs-delete` — throwaway git worktrees for a
// PR's base and target commits, and the cleanup that reverses them. See
// README.md's "checkout" / "dispose" / "refs-delete" sections.

import path from 'node:path';
import fs from 'node:fs/promises';
import { worktreeAdd, worktreeRemove, deleteRefs } from './lib/git.mjs';

async function linkNodeModules(repo, dir) {
  const source = path.join(repo, 'node_modules');
  const dest = path.join(dir, 'node_modules');
  try {
    await fs.access(source);
  } catch {
    return false; // nothing to link — repo has no installed deps
  }
  try {
    await fs.access(dest);
    return false; // already present (shouldn't happen on a fresh worktree)
  } catch {
    // expected — proceed to link
  }
  await fs.symlink(source, dest, 'dir');
  return true;
}

async function copyEnvFiles(repo, dir) {
  const copied = [];
  for (const name of ['.env', '.env.local']) {
    const source = path.join(repo, name);
    try {
      await fs.copyFile(source, path.join(dir, name));
      copied.push(name);
    } catch {
      // fine — not every repo/env has these
    }
  }
  return copied;
}

export async function checkout(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const { ref, dir } = args;
  if (!ref || !dir) {
    console.error('checkout requires --repo --ref --dir');
    process.exitCode = 1;
    return;
  }
  const absDir = path.resolve(dir);
  await worktreeAdd(repo, absDir, ref);
  const linkedNodeModules = await linkNodeModules(repo, absDir);
  const envFiles = await copyEnvFiles(repo, absDir);
  console.log(JSON.stringify({ ok: true, dir: absDir, ref, linkedNodeModules, envFiles }));
}

export async function dispose(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const { dir } = args;
  if (!dir) {
    console.error('dispose requires --repo --dir');
    process.exitCode = 1;
    return;
  }
  const absDir = path.resolve(dir);
  const nodeModulesPath = path.join(absDir, 'node_modules');
  try {
    const stat = await fs.lstat(nodeModulesPath);
    if (stat.isSymbolicLink()) {
      // Unlink the symlink itself before the worktree is removed, so a
      // partial/interrupted removal can never chase the link into the
      // repo's real node_modules and delete it.
      await fs.unlink(nodeModulesPath);
    }
  } catch {
    // no node_modules to unlink — fine
  }
  await worktreeRemove(repo, absDir);
  console.log(JSON.stringify({ ok: true, dir: absDir }));
}

export async function refsDelete(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const pr = args.pr;
  if (!pr) {
    console.error('refs-delete requires --repo --pr');
    process.exitCode = 1;
    return;
  }
  await deleteRefs(repo, pr);
  console.log(JSON.stringify({ ok: true, pr: Number(pr) }));
}
