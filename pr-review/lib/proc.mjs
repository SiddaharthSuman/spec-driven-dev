// Small process-running helpers. Every external command (git, gh, tsc,
// eslint, the test runner, npx vite) goes through one of these so error
// handling and output capture stay consistent across modules.

import { execFile, spawn } from 'node:child_process';

const MAX_BUFFER = 64 * 1024 * 1024; // 64MB — a full vitest/eslint JSON run can be large

// Runs a command to completion, resolving even on non-zero exit (callers
// decide whether a non-zero code is an error or just "found problems").
export function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd: opts.cwd, env: { ...process.env, ...opts.env }, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        resolve({
          ok: !err || err.code === 0,
          code: err && typeof err.code === 'number' ? err.code : 0,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          error: err && typeof err.code !== 'number' ? err : null,
        });
      }
    );
  });
}

// Runs a command that fails the caller if it doesn't exit 0 — for git
// plumbing where a non-zero exit really is a hard error.
export async function runOrThrow(cmd, args, opts = {}) {
  const result = await run(cmd, args, opts);
  if (!result.ok) {
    throw new Error(
      `${cmd} ${args.join(' ')} failed (${result.code}): ${result.stderr || result.stdout}`
    );
  }
  return result.stdout;
}

// Spawns a long-running process (a dev server) and returns the child handle
// immediately — used by servers.mjs, which stays alive as the server.
export function spawnLong(cmd, args, opts = {}) {
  return spawn(cmd, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: opts.stdio ?? 'inherit',
  });
}
