// Regression test for the GLOBAL_ENTRY_PATTERN false-positive bug found
// while building this package: a page's own index.tsx (e.g.
// src/pages/reports/index.tsx) must NOT be treated as a global entry point
// just because it's named "index", only a main/index/App file OUTSIDE any
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

  // A page with no importers at all, isolated, must never be "global".
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

test('routes: a shared file reached by the real main.tsx entry point is global, and globalHits names main.tsx (not the intermediate file)', async () => {
  const logs = await captureLog(() => routes({ repo, files: 'src/shell.tsx' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.global, true);
  assert.deepEqual(result.globalHits, ['src/main.tsx']);
  assert.ok(!result.globalHits.includes('src/shell.tsx'));
});

test('routes: a changed page stays scoped even though the app entry point imports it', async () => {
  const logs = await captureLog(() => routes({ repo, files: 'src/pages/invoices/index.tsx' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.global, false);
  assert.deepEqual(result.paths, ['/invoices']);
});
test('routes: with no changed files given, falls back to a conservative global:true rather than guessing', async () => {
  const logs = await captureLog(() => routes({ repo, files: '' }));
  const result = JSON.parse(logs[0]);
  assert.equal(result.global, true);
  assert.equal(result.reason, 'no changed files given');
});

// ---- TanStack Router style tree, including the generated routeTree.gen.ts

test('routeFromPagePath: TanStack, Next and Remix naming', async () => {
  const { routeFromPagePath } = await import('../affected-routes.mjs');
  const cases = {
    'src/routes/index.tsx': '/',
    'src/routes/about.tsx': '/about',
    'src/routes/posts.$postId.tsx': '/posts/:postId',
    'src/routes/posts/$postId.lazy.tsx': '/posts/:postId',
    'src/routes/posts/index.tsx': '/posts',
    'src/routes/posts/route.tsx': '/posts',
    'src/routes/_auth.dashboard.tsx': '/dashboard',
    'src/routes/_auth/settings.tsx': '/settings',
    'src/routes/_auth.tsx': null,
    'src/routes/files.$.tsx': '/files/*',
    'src/routes/posts_.edit.tsx': '/posts/edit',
    'src/routes/(marketing)/pricing.tsx': '/pricing',
    'src/pages/invoices/[id].tsx': '/invoices/:id',
    'src/pages/docs/[...slug].tsx': '/docs/*',
    'src/pages/Reports/index.tsx': '/Reports',
  };
  for (const [file, expected] of Object.entries(cases)) assert.equal(routeFromPagePath(file), expected, file);
});

test('isRouteFile: helper files in a routes directory are not routes', async () => {
  const { isRouteFile } = await import('../affected-routes.mjs');
  assert.equal(isRouteFile('src/routes/posts.tsx'), true);
  assert.equal(isRouteFile('src/routes/-components/Card.tsx'), false);
  assert.equal(isRouteFile('src/routes/-helpers.ts'), false);
  assert.equal(isRouteFile('src/routes/posts.test.tsx'), false);
  assert.equal(isRouteFile('src/routeTree.gen.ts'), false);
  assert.equal(isRouteFile('src/routes/__root.tsx'), false);
  assert.equal(isRouteFile('src/components/Button.tsx'), false);
});

async function tanstackRepo() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-tanstack-'));
  const write = async (rel, content) => {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), content);
  };
  await write(
    'tsconfig.json',
    JSON.stringify({
      compilerOptions: { module: 'esnext', moduleResolution: 'node', jsx: 'react-jsx', target: 'es2020', allowJs: true, esModuleInterop: true },
      include: ['src/**/*'],
    })
  );
  const page = 'export default function P() { return null; }\n';
  await write('src/components/Card.tsx', 'export const Card = () => null;\n');
  await write('src/components/Orphan.tsx', 'export const Orphan = () => null;\n');
  await write('src/routes/__root.tsx', 'export const Route = {};\n');
  await write('src/routes/index.tsx', page);
  await write('src/routes/about.tsx', "import { Card } from '../components/Card';\nexport default Card;\n");
  await write('src/routes/posts.tsx', page);
  await write('src/routes/posts.index.tsx', page);
  await write('src/routes/posts.$postId.tsx', page);
  await write('src/routes/_auth.tsx', page);
  await write('src/routes/_auth.dashboard.tsx', page);
  await write('src/routes/settings/route.tsx', page);
  await write('src/routes/settings/profile.tsx', page);
  await write('src/routes/settings/-private/Form.tsx', "import { Card } from '../../../components/Card';\nexport default Card;\n");
  await write('src/routes/settings/billing.tsx', "import Form from './-private/Form';\nexport default Form;\n");
  // The generated tree imports every route, and main imports the tree.
  await write(
    'src/routeTree.gen.ts',
    [
      "import * as a from './routes/index';",
      "import * as b from './routes/about';",
      "import * as c from './routes/posts';",
      "import * as d from './routes/_auth.dashboard';",
      "export const routeTree = [a, b, c, d];",
      '',
    ].join('\n')
  );
  await write('src/main.tsx', "import { routeTree } from './routeTree.gen';\nexport default routeTree;\n");
  return dir;
}

async function changed(repoDir, files) {
  return JSON.parse((await captureLog(() => routes({ repo: repoDir, files })))[0]);
}

test('routes (TanStack): changing one route file scopes to that route, not global, despite routeTree.gen.ts and main.tsx', async () => {
  const dir = await tanstackRepo();
  try {
    const r = await changed(dir, 'src/routes/about.tsx');
    assert.equal(r.global, false);
    assert.deepEqual(r.paths, ['/about']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('routes (TanStack): a shared component maps to the routes that import it, including through a -private helper', async () => {
  const dir = await tanstackRepo();
  try {
    const r = await changed(dir, 'src/components/Card.tsx');
    assert.equal(r.global, false);
    assert.deepEqual(r.paths, ['/about', '/settings/billing']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('routes (TanStack): a component nothing imports affects no routes and is not global', async () => {
  const dir = await tanstackRepo();
  try {
    const r = await changed(dir, 'src/components/Orphan.tsx');
    assert.equal(r.global, false);
    assert.deepEqual(r.paths, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('routes (TanStack): a layout (route.tsx, _auth, flat parent) affects its whole subtree', async () => {
  const dir = await tanstackRepo();
  try {
    const dirLayout = await changed(dir, 'src/routes/settings/route.tsx');
    assert.deepEqual(dirLayout.paths, ['/settings', '/settings/billing', '/settings/profile']);
    const pathless = await changed(dir, 'src/routes/_auth.tsx');
    assert.deepEqual(pathless.paths, ['/dashboard']);
    const flat = await changed(dir, 'src/routes/posts.tsx');
    assert.deepEqual(flat.paths, ['/posts', '/posts/:postId']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('routes (TanStack): changing __root is global', async () => {
  const dir = await tanstackRepo();
  try {
    const r = await changed(dir, 'src/routes/__root.tsx');
    assert.equal(r.global, true);
    assert.deepEqual(r.globalHits, ['src/routes/__root.tsx']);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('sweep: parameterised routes are reported as skipped, not loaded with a literal :id', async () => {
  const { sweep } = await import('../affected-routes.mjs');
  const file = path.join(os.tmpdir(), `pr-review-routes-${process.pid}.json`);
  await fs.writeFile(file, JSON.stringify({ paths: ['/', '/posts', '/posts/:postId', '/files/*'] }));
  try {
    const out = JSON.parse((await captureLog(() => sweep({ routes: file, max: '2' })))[0]);
    assert.deepEqual(out.scenarios.map((x) => x.route), ['/', '/posts']);
    assert.deepEqual(out.skipped.map((x) => x.route), ['/posts/:postId', '/files/*']);
    assert.equal(out.scenarios[0].name, 'sweep-home');
  } finally {
    await fs.rm(file, { force: true });
  }
});

test('sweep: accepts a plain list and {path} objects as well as the routes output', async () => {
  const { sweep } = await import('../affected-routes.mjs');
  const file = path.join(os.tmpdir(), `pr-review-routes-list-${process.pid}.json`);
  await fs.writeFile(file, JSON.stringify([{ path: '/a' }, '/b']));
  try {
    const out = JSON.parse((await captureLog(() => sweep({ routes: file })))[0]);
    assert.deepEqual(out.scenarios.map((x) => x.route), ['/a', '/b']);
  } finally {
    await fs.rm(file, { force: true });
  }
});
