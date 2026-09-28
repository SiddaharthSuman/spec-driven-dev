// Regression test for the GLOBAL_ENTRY_PATTERN false-positive bug found
// while building this package: a page's own index.tsx (e.g.
// src/pages/reports/index.tsx) must NOT be treated as a global entry point
// just because it's named "index" — only a main/index/App file OUTSIDE any
// pages/routes directory counts. Builds a real tiny TS project on disk so
// this exercises the actual TypeScript compiler API, not a mock.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { routes } from '../affected-routes.mjs';

let repo;

before(async () => {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-tsproj-'));

  const write = async (rel, content) => {
    const abs = path.join(repo, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  };

  await write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: {
        module: 'esnext',
        moduleResolution: 'node',
        jsx: 'react-jsx',
        target: 'es2020',
        allowJs: true,
        esModuleInterop: true,
      },
      include: ['src/**/*'],
    })
  );

  // A page with no importers at all — isolated, must never be "global".
  await write('src/pages/reports/index.tsx', 'export default function Reports() { return null; }\n');

  // A page transitively reached from the app's real global entry point,
  // through one intermediate non-page file.
  await write(
    'src/pages/invoices/index.tsx',
    'export default function Invoices() { return null; }\n'
  );
  await write(
    'src/shell.tsx',
    "import Invoices from './pages/invoices';\nexport function Shell() { return Invoices; }\n"
  );
  await write(
    'src/main.tsx',
    "import { Shell } from './shell';\nconst _ = Shell;\n"
  );
});

after(async () => {
  await fs.rm(repo, { recursive: true, force: true });
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

test('routes: an isolated page (its own index.tsx) is scoped, never reported as global', async () => {
  const logs = await captureLog(() => routes({ repo, files: 'src/pages/reports/index.tsx' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.global, false);
  assert.deepEqual(result.paths, ['/reports']);
});

test('routes: a page reached transitively by the real main.tsx entry point is global, and globalHits names main.tsx (not the intermediate file)', async () => {
  const logs = await captureLog(() => routes({ repo, files: 'src/pages/invoices/index.tsx' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.global, true);
  assert.deepEqual(result.globalHits, ['src/main.tsx']);
  assert.ok(!result.globalHits.includes('src/shell.tsx'));
});

test('routes: with no changed files given, falls back to a conservative global:true rather than guessing', async () => {
  const logs = await captureLog(() => routes({ repo, files: '' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.global, true);
  assert.equal(result.reason, 'no changed files given');
});
