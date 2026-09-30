// Golden-parity test: the exact fixtures -> assemble -> validate -> render
// pipeline test/smoke.mjs used to produce golden/report.{html,md} must still
// produce that same output. A module change that alters the golden output
// on this unrelated fixture PR is almost always a regression, not an
// intended change: see README.md's "Testing" section.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildFindings } from '../assemble.mjs';
import { validate } from '../schema.mjs';
import { buildReport } from '../build-report.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(HERE, '..', 'fixtures');
const GOLDEN = path.join(HERE, '..', 'golden');

const META = {
  pr: 812,
  repo: 'siddaharthsuman/example-app',
  head: '2222222222222222222222222222222222222222',
  merge: 'none',
  base: '1111111111111111111111111111111111111111',
  baseBranch: 'main',
};

// Strips the one line in report.html that legitimately changes every run
// (the render timestamp), so the rest can be compared byte-for-byte.
function stripGeneratedAt(html) {
  return html.replace(/Generated .+? &middot;/, 'Generated <normalized> &middot;');
}

async function renderFixturePipeline() {
  const [review, triage, checks, visual] = await Promise.all([
    fs.readFile(path.join(FIXTURES, 'review.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'triage.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'checks.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'visual.example.json'), 'utf8').then(JSON.parse),
  ]);

  const findings = buildFindings({ review, triage, checks, visual, meta: META });
  // finish.mjs enriches diffFiles with real git-diff text via unifiedDiff;
  // this test has no repo on disk, so it fabricates the same shape
  // test/smoke.mjs uses to produce the checked-in golden files.
  findings.diffFiles = review.changes.diffFiles.map((p) => ({
    path: p,
    diff: `--- a/${p}\n+++ b/${p}\n@@ -40,6 +40,7 @@\n-  return true;\n+  return start <= end;\n`,
  }));

  return findings;
}

test('render pipeline: the fixture PR assembles into schema-valid findings', async () => {
  const findings = await renderFixturePipeline();
  const { ok, errors } = validate(findings);
  assert.equal(ok, true, `unexpected errors: ${errors.join('; ')}`);
});

test('render pipeline: report.md matches the checked-in golden byte-for-byte', async () => {
  const findings = await renderFixturePipeline();
  const { markdown } = await buildReport(findings);
  const golden = await fs.readFile(path.join(GOLDEN, 'report.md'), 'utf8');
  assert.equal(markdown, golden);
});

test('render pipeline: report.html matches the checked-in golden aside from the generated-at timestamp', async () => {
  const findings = await renderFixturePipeline();
  const { html } = await buildReport(findings);
  const golden = await fs.readFile(path.join(GOLDEN, 'report.html'), 'utf8');
  assert.equal(stripGeneratedAt(html), stripGeneratedAt(golden));
});

test('render pipeline: report.html embeds the exact markdown text for the copy button to read', async () => {
  const findings = await renderFixturePipeline();
  const { html, markdown } = await buildReport(findings);
  assert.ok(html.includes('id="markdown-source"'));
  // The embedded text is HTML-escaped, so check for a substring that
  // survives escaping untouched rather than the raw markdown.
  assert.ok(html.includes(markdown.split('\n')[0]));
});
