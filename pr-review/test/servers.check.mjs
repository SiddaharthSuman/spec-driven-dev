// Tests for `serve` command selection: the project's own dev command wins,
// Vite is the fallback only when installed, and a missing Vite is an error
// with a clear message instead of an npx download.

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildServeCommand } from '../servers.mjs';

test('serve: --cmd replaces {port} and runs through a shell', () => {
  const plan = buildServeCommand({ dir: '/d', port: 4173, cmd: 'npm run dev -- --port {port}', hasVite: false });
  assert.deepEqual(plan.args, ['-c', 'npm run dev -- --port 4173']);
});

test('serve: --cmd without {port} gets --port appended', () => {
  const plan = buildServeCommand({ dir: '/d', port: 5000, cmd: 'pnpm dev', hasVite: true });
  assert.equal(plan.label, 'pnpm dev --port 5000');
});

test('serve: without --cmd, uses the checkout\'s own vite binary with a strict port', () => {
  const plan = buildServeCommand({ dir: '/d', port: 4000, hasVite: true });
  assert.equal(plan.file, '/d/node_modules/.bin/vite');
  assert.deepEqual(plan.args, ['--port', '4000', '--strictPort']);
});

test('serve: no --cmd and no vite means no plan', () => {
  assert.equal(buildServeCommand({ dir: '/d', port: 4000, hasVite: false }), null);
});
