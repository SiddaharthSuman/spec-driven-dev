// capture runs real Chromium against two local servers, so the whole file
// skips with a clear reason when Playwright or a launchable browser is not
// available (same approach as imgdiff.check.mjs).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capture, parseMock, buildKnownLimits } from '../capture.mjs';
import { launchChromium } from '../lib/browser.mjs';

let playwright;
try {
  playwright = await import('playwright');
} catch {
  playwright = null;
}

let canLaunch = false;
if (playwright) {
  try {
    const b = await launchChromium(playwright);
    await b.close();
    canLaunch = true;
  } catch {
    canLaunch = false;
  }
}
const skip = !playwright ? 'playwright is not installed' : !canLaunch ? 'no launchable Chromium' : false;

// A tiny app. "/" shows a heading, and sends the browser to /login when there
// is no token in localStorage or the /api/data call does not succeed.
function appServer(heading) {
  const page = `<!doctype html><html><body><h1 id="h">${heading}</h1><script>
    if (!localStorage.getItem('token')) { location.replace('/login'); }
    else { fetch('/api/data').then(r => { if (!r.ok) location.replace('/login'); }).catch(() => location.replace('/login')); }
  </script></body></html>`;
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      if (req.url === '/api/data') {
        res.statusCode = 404;
        res.end('no');
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end(req.url.startsWith('/login') ? '<h1 id="h">Login</h1>' : page);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

async function run(plan, base, head) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-'));
  const planPath = path.join(dir, 'plan.json');
  await fs.writeFile(planPath, JSON.stringify(plan));
  const out = path.join(dir, 'out');
  const oldLog = console.log;
  console.log = () => {};
  try {
    await capture({ plan: planPath, base: urlOf(base), head: urlOf(head), out });
  } finally {
    console.log = oldLog;
  }
  return JSON.parse(await fs.readFile(path.join(out, 'visual.json'), 'utf8'));
}

const steps = [{ type: 'goto' }, { type: 'waitFor', selector: '#h' }, { type: 'shot' }];

test('parseMock reads METHOD and glob, and skips entries with no payload', () => {
  assert.deepEqual(parseMock('GET **/api/x**', { json: { a: 1 } }), { method: 'GET', glob: '**/api/x**', response: { json: { a: 1 } } });
  assert.equal(parseMock('**/api/x**', { json: 1 }).method, null);
  assert.equal(parseMock('GET **/api/x**', { shape: 'from a service file' }), null);
});

test('with no auth and no mocks, nothing app-specific is applied and no limits are claimed', () => {
  assert.deepEqual(buildKnownLimits({ scenarios: [{ name: 'a', steps }] }), []);
});

test('a scenario that lands on /login is unreliable, and an unchanged page is unchanged', { skip }, async () => {
  const base = await appServer('Same');
  const head = await appServer('Same');
  try {
    const v = await run({ scenarios: [{ name: 'needs-login', route: '/', steps }] }, base, head);
    assert.equal(v.scenarios[0].status, 'unreliable');
    assert.match(v.scenarios[0].note, /login/);
    assert.deepEqual(v.knownLimits, []);
    assert.match(v.tryIt[1], /AGENTS\.md/);
  } finally {
    base.close();
    head.close();
  }
});

test('plan.auth and scenario mocks get past the login, and a real change is captured', { skip }, async () => {
  const base = await appServer('Before');
  const head = await appServer('After the change, with a much longer heading text');
  const plan = {
    devCommand: 'npm run dev',
    knownLimits: ['Custom note.'],
    auth: { localStorage: { token: 't' }, roleKey: 'role' },
    scenarios: [
      { name: 'changed', route: '/', role: 'admin', mocks: { 'GET **/api/data': { json: { ok: true } } }, steps },
      { name: 'same', route: '/', mocks: { 'GET **/api/data': { json: { ok: true } } }, steps },
    ],
  };
  try {
    const v = await run(plan, base, head);
    const byName = Object.fromEntries(v.scenarios.map((s) => [s.name, s]));
    assert.equal(byName.changed.status, 'captured');
    assert.ok(byName.changed.diffScore > 0);
    assert.equal(v.tryIt[1], 'npm run dev');
    assert.ok(v.knownLimits.some((l) => /Authentication is mocked/.test(l)));
    assert.ok(v.knownLimits.some((l) => /API responses/.test(l)));
    assert.ok(v.knownLimits.includes('Custom note.'));
  } finally {
    base.close();
    head.close();
  }
});

test('a scenario with a bad step is reported as failed, not thrown', { skip }, async () => {
  const base = await appServer('x');
  const head = await appServer('x');
  try {
    const v = await run({ scenarios: [{ name: 'bad', route: '/', steps: [{ type: 'hover' }] }] }, base, head);
    assert.equal(v.scenarios[0].status, 'failed');
    assert.match(v.scenarios[0].error, /unknown step type/);
  } finally {
    base.close();
    head.close();
  }
});
