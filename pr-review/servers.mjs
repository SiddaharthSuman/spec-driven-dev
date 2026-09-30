// `serve`: boots a throwaway Vite dev server against a checked-out
// worktree on a given port. Meant to be run in the background by the
// caller, which polls the port itself (see README.md's "serve" section)
// and kills this process when done.

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnLong } from './lib/proc.mjs';

// Builds the command to boot. With --cmd, the project's own dev command is
// used with "{port}" replaced (e.g. --cmd "npm run dev -- --port {port}").
// Without it, Vite is used, and only when the checkout actually has it.
export function buildServeCommand({ dir, port, cmd, hasVite }) {
  if (cmd) {
    const withPort = String(cmd).includes('{port}') ? String(cmd).replaceAll('{port}', String(port)) : `${cmd} --port ${port}`;
    return { file: 'sh', args: ['-c', withPort], label: withPort };
  }
  if (!hasVite) return null;
  return { file: path.join(dir, 'node_modules', '.bin', 'vite'), args: ['--port', String(port), '--strictPort'], label: 'vite' };
}

async function hasLocalVite(dir) {
  try {
    await fs.access(path.join(dir, 'node_modules', '.bin', 'vite'));
    return true;
  } catch {
    return false;
  }
}

export async function serve(args) {
  const dir = path.resolve(args.dir || process.cwd());
  const port = args.port;
  if (!port) {
    console.error('serve requires --dir --port');
    process.exitCode = 1;
    return;
  }

  const plan = buildServeCommand({
    dir,
    port,
    cmd: typeof args.cmd === 'string' ? args.cmd : undefined,
    hasVite: await hasLocalVite(dir),
  });
  if (!plan) {
    console.error('serve: no --cmd given and Vite is not installed in this checkout. Pass the project dev command with --cmd, for example --cmd "npm run dev -- --port {port}".');
    process.exitCode = 1;
    return;
  }

  const child = spawnLong(plan.file, plan.args, {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Surface startup failures (e.g. port already taken) without dumping the
  // dev server's normal request-logging noise into the caller's context.
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (/EADDRINUSE|error/i.test(text)) process.stderr.write(text);
  });

  console.log(JSON.stringify({ ok: true, pid: child.pid, port: Number(port), dir, command: plan.label }));

  const shutdown = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });

  // Keep this process alive until the child exits or we're signaled:
  // this command IS the server for as long as the caller needs it.
  await new Promise((resolve) => child.on('exit', resolve));
}
