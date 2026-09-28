// `serve` — boots a throwaway Vite dev server against a checked-out
// worktree on a given port. Meant to be run in the background by the
// caller, which polls the port itself (see README.md's "serve" section)
// and kills this process when done.

import path from 'node:path';
import { spawnLong } from './lib/proc.mjs';

export async function serve(args) {
  const dir = path.resolve(args.dir || process.cwd());
  const port = args.port;
  if (!port) {
    console.error('serve requires --dir --port');
    process.exitCode = 1;
    return;
  }

  const child = spawnLong('npx', ['vite', '--port', String(port), '--strictPort'], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Surface startup failures (e.g. port already taken) without dumping the
  // dev server's normal request-logging noise into the caller's context.
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (/EADDRINUSE|error/i.test(text)) process.stderr.write(text);
  });

  console.log(JSON.stringify({ ok: true, pid: child.pid, port: Number(port), dir }));

  const shutdown = () => {
    child.kill('SIGTERM');
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  child.on('exit', (code) => {
    process.exitCode = code ?? 0;
  });

  // Keep this process alive until the child exits or we're signaled —
  // this command IS the server for as long as the caller needs it.
  await new Promise((resolve) => child.on('exit', resolve));
}
