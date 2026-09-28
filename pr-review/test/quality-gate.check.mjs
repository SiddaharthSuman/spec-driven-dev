// Runs the real headless-browser quality gate against the checked-in
// golden/report.html (an approved-good report) and against a deliberately
// broken page, so both "a good report passes" and "a real defect is
// actually caught" are covered. Needs Playwright + a launchable Chromium;
// skips with a clear reason otherwise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runGate } from '../quality-gate.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const GOLDEN_HTML = path.join(HERE, '..', 'golden', 'report.html');

let playwrightAvailable = true;
try {
  await import('playwright');
} catch {
  playwrightAvailable = false;
}
const skip = !playwrightAvailable ? 'playwright is not installed' : false;

test('runGate: the checked-in golden report passes every check', { skip }, async () => {
  const result = await runGate(GOLDEN_HTML);
  assert.deepEqual(result, { ok: true, failures: [] });
});

test('runGate: a report with two <h1>s and no lang attribute is caught, not silently passed', { skip }, async () => {
  const broken = (await fs.readFile(GOLDEN_HTML, 'utf8'))
    .replace('<h1 lang="en">', '<h1>')
    .replace('</h1>\n', '</h1>\n<h1>Second heading</h1>\n');

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-gate-'));
  const brokenPath = path.join(dir, 'broken.html');
  await fs.writeFile(brokenPath, broken);

  const result = await runGate(brokenPath);
  await fs.rm(dir, { recursive: true, force: true });

  assert.equal(result.ok, false);
  assert.ok(
    result.failures.some((f) => f.includes('exactly one <h1>')),
    `expected an h1-count failure, got: ${JSON.stringify(result.failures)}`
  );
});
