import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { validate } from '../schema.mjs';
import { buildFindings } from '../assemble.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(HERE, '..', 'fixtures');
const META = {
  pr: 812,
  repo: 'siddaharthsuman/example-app',
  head: '2222222222222222222222222222222222222222',
  merge: 'none',
  base: '1111111111111111111111111111111111111111',
  baseBranch: 'main',
};

async function loadFixtureFindings() {
  const [review, triage, checks, visual] = await Promise.all([
    fs.readFile(path.join(FIXTURES, 'review.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'triage.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'checks.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'visual.example.json'), 'utf8').then(JSON.parse),
  ]);
  return buildFindings({ review, triage, checks, visual, meta: META });
}

test('validate: the real review.example.json fixture, once assembled, is schema-valid', async () => {
  const findings = await loadFixtureFindings();
  const { ok, errors } = validate(findings);
  assert.equal(ok, true, `unexpected errors: ${errors.join('; ')}`);
});

test('validate: rejects a decision outside the fixed enum', async () => {
  const findings = await loadFixtureFindings();
  findings.decision = 'LGTM';
  const { ok, errors } = validate(findings);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('decision must be one of')));
});

test('validate: rubric must have exactly 5 entries', async () => {
  const findings = await loadFixtureFindings();
  findings.rubric = findings.rubric.slice(0, 3);
  const { ok, errors } = validate(findings);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('exactly 5 entries')));
});

test('validate: Approve cannot coexist with a blocking finding', async () => {
  const findings = await loadFixtureFindings();
  // The fixture has a blocking finding (B1) and correctly says "Request
  // changes": forcing it to "Approve" without removing B1 must fail.
  assert.equal(findings.findings.some((f) => f.severity === 'blocking'), true);
  findings.decision = 'Approve';
  const { ok, errors } = validate(findings);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('blocking finding exists')));
});

test('validate: a blocking finding forces "Request changes"', async () => {
  const findings = await loadFixtureFindings();
  findings.decision = 'Comment';
  const { ok, errors } = validate(findings);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('not "Request changes"')));
});

test('validate: diffFiles is capped at 3 entries', async () => {
  const findings = await loadFixtureFindings();
  findings.diffFiles = ['a.ts', 'b.ts', 'c.ts', 'd.ts'];
  const { ok, errors } = validate(findings);
  assert.equal(ok, false);
  assert.ok(errors.some((e) => e.includes('at most 3 entries')));
});
