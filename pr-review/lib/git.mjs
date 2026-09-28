// Shared git plumbing. Every module that touches a repo goes through here
// so the fetch/ref/worktree conventions stay identical across prepare,
// checkout, triage, and diff.

import { runOrThrow, run } from './proc.mjs';

// Namespace every ref this tool creates under refs/pr-review/<pr>/... so
// refs-delete can clean up precisely and nothing collides with a
// developer's own local branches.
export function prRefs(pr) {
  return {
    head: `refs/pr-review/${pr}/head`,
    merge: `refs/pr-review/${pr}/merge`,
    base: `refs/pr-review/${pr}/base`,
  };
}

export async function fetchBaseBranch(repo, pr, baseRefName) {
  const refs = prRefs(pr);
  await runOrThrow('git', ['fetch', 'origin', `${baseRefName}:${refs.base}`], { cwd: repo });
  return refs.base;
}

export async function fetchPr(repo, pr) {
  const refs = prRefs(pr);
  await runOrThrow(
    'git',
    ['fetch', 'origin', `pull/${pr}/head:${refs.head}`],
    { cwd: repo }
  );
  // The merge ref only exists while GitHub considers the PR cleanly
  // mergeable — a real conflict means this fetch fails, which is expected,
  // not an error to surface.
  const mergeResult = await run(
    'git',
    ['fetch', 'origin', `pull/${pr}/merge:${refs.merge}`],
    { cwd: repo }
  );
  return { headRef: refs.head, mergeRef: mergeResult.ok ? refs.merge : null };
}

export async function revParse(repo, ref) {
  const out = await runOrThrow('git', ['rev-parse', ref], { cwd: repo });
  return out.trim();
}

export async function mergeBase(repo, a, b) {
  const out = await runOrThrow('git', ['merge-base', a, b], { cwd: repo });
  return out.trim();
}

export async function deleteRefs(repo, pr) {
  const refs = prRefs(pr);
  for (const ref of [refs.head, refs.merge, refs.base]) {
    await run('git', ['update-ref', '-d', ref], { cwd: repo });
  }
}

export async function worktreeAdd(repo, dir, ref) {
  await runOrThrow('git', ['worktree', 'add', '--detach', dir, ref], { cwd: repo });
}

export async function worktreeRemove(repo, dir) {
  const result = await run('git', ['worktree', 'remove', '--force', dir], { cwd: repo });
  if (!result.ok) {
    // Directory may already be gone (e.g. an earlier interrupted cleanup) —
    // prune below reconciles git's own bookkeeping either way.
  }
  await run('git', ['worktree', 'prune'], { cwd: repo });
}

export async function checkIgnored(repo, relPath) {
  const result = await run('git', ['check-ignore', '-q', relPath], { cwd: repo });
  return result.ok; // exit 0 = ignored
}

export async function nameStatus(repo, from, to) {
  const out = await runOrThrow(
    'git',
    ['diff', '--name-status', '--find-renames', `${from}..${to}`],
    { cwd: repo }
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split('\t');
      // Renames come back as "R100\told\tnew"
      if (status.startsWith('R')) {
        return { status: 'R', path: rest[1], oldPath: rest[0], similarity: Number(status.slice(1)) };
      }
      return { status, path: rest[0] };
    });
}

export async function numstat(repo, from, to, extraArgs = []) {
  const out = await runOrThrow(
    'git',
    ['diff', '--numstat', ...extraArgs, `${from}..${to}`],
    { cwd: repo }
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [add, del, ...pathParts] = line.split('\t');
      return {
        path: pathParts.join('\t'),
        additions: add === '-' ? 0 : Number(add),
        deletions: del === '-' ? 0 : Number(del),
      };
    });
}

export async function unifiedDiff(repo, from, to, paths, unified = 2) {
  const args = ['diff', `--unified=${unified}`, `${from}..${to}`, '--'];
  const out = await runOrThrow('git', [...args, ...paths], { cwd: repo });
  return out;
}

export async function remoteNameWithOwner(repo) {
  const result = await run('gh', ['repo', 'view', '--json', 'nameWithOwner'], { cwd: repo });
  if (result.ok) {
    try {
      return JSON.parse(result.stdout).nameWithOwner;
    } catch {
      // fall through to git-remote parsing below
    }
  }
  const out = await runOrThrow('git', ['remote', 'get-url', 'origin'], { cwd: repo });
  const match = out.trim().match(/[:/]([^/]+\/[^/]+?)(\.git)?$/);
  return match ? match[1] : out.trim();
}

export async function prMeta(repo, pr) {
  const result = await run(
    'gh',
    ['pr', 'view', String(pr), '--json', 'baseRefName,headRefName,mergeable,title'],
    { cwd: repo }
  );
  if (!result.ok) {
    throw new Error(`gh pr view ${pr} failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout);
}
