import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFindings } from '../assemble.mjs';

const BASE_REVIEW = {
  decision: 'Approve',
  confidence: 5,
  riskLevel: 1,
  lede: 'Looks fine.',
  rubric: [true, true, true, true, true],
  lenses: {},
  findings: [],
  spec: { linked: false, path: null },
  changes: { diffFiles: [], flow: null },
  notVerifiedExtra: [],
};

const META = {
  pr: 1,
  repo: 'org/app',
  head: 'aaaa',
  merge: 'none',
  base: 'bbbb',
  baseBranch: 'main',
};

test('buildFindings: the "typecheck/lint/tests pass" rubric row is cross-checked against real checks evidence, not the agent\'s own boolean', () => {
  // The agent says rubric[1] (index 1 = that row) is true, but real checks
  // evidence disagrees: evidence must win.
  const checks = { typecheck: { errors: 1 }, lint: { errors: 0 }, tests: { failed: 0 } };
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks, visual: null, meta: META });
  assert.equal(findings.rubric[1].pass, false);
  // The other four rows still trust the agent's own rubric booleans.
  assert.equal(findings.rubric[0].pass, true);
  assert.equal(findings.rubric[2].pass, true);
});

test('buildFindings: when no checks evidence is supplied, the row falls back to the agent\'s boolean', () => {
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks: null, visual: null, meta: META });
  assert.equal(findings.rubric[1].pass, true);
});

test('buildFindings: coverage percentage counts captured + new scenarios out of the total', () => {
  const visual = {
    scenarios: [
      { name: 'a', status: 'captured' },
      { name: 'b', status: 'new' },
      { name: 'c', status: 'unchanged' },
      { name: 'd', status: 'failed' },
    ],
  };
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks: null, visual, meta: META });
  assert.equal(findings.coverage.totalScenarios, 4);
  assert.equal(findings.coverage.capturedScenarios, 2);
  assert.equal(findings.coverage.visualPct, 50);
});

test('buildFindings: no visual scenarios at all yields a null percentage, not zero', () => {
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks: null, visual: null, meta: META });
  assert.equal(findings.coverage.totalScenarios, 0);
  assert.equal(findings.coverage.visualPct, null);
});

test('buildFindings: blockingCount reflects only findings with severity "blocking"', () => {
  const review = {
    ...BASE_REVIEW,
    findings: [
      { id: 'B1', severity: 'blocking', summary: 'x' },
      { id: 'N1', severity: 'low', summary: 'y' },
    ],
  };
  const findings = buildFindings({ review, triage: null, checks: null, visual: null, meta: META });
  assert.equal(findings.blockingCount, 1);
});

test('buildFindings: facts pull sizeTier/reviewableLines/unit counts straight from triage', () => {
  const triage = {
    tier: 'M',
    reviewableLines: 900,
    totalFiles: 5,
    excludedFileCount: 1,
    units: { deep: [{}], skimmed: [{}, {}] },
  };
  const findings = buildFindings({ review: BASE_REVIEW, triage, checks: null, visual: null, meta: META });
  assert.deepEqual(findings.facts, {
    sizeTier: 'M',
    reviewableLines: 900,
    changedFiles: 5,
    excludedFiles: 1,
    deepUnits: 1,
    skimmedUnits: 2,
  });
});

test('buildFindings: an unknown check row is never a pass and is listed as not verified', () => {
  const checks = {
    typecheck: { status: 'unknown', note: 'timed out after 10 min' },
    lint: { status: 'pass', errors: 0 },
    tests: { status: 'pass', failed: 0 },
  };
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks, visual: null, meta: META });
  assert.equal(findings.rubric[1].pass, false);
  assert.ok(findings.notVerifiedExtra.some((l) => l.includes('Typecheck could not be verified')));
});

test('buildFindings: preexisting and skipped rows do not block, but preexisting is disclosed', () => {
  const checks = {
    typecheck: { status: 'preexisting', errors: 3, baseErrors: 3 },
    lint: { status: 'skipped', note: 'no lintable files changed' },
    tests: { status: 'pass', failed: 0 },
  };
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks, visual: null, meta: META });
  assert.equal(findings.rubric[1].pass, true);
  assert.equal(findings.notVerifiedExtra.length, 2);
});

test('buildFindings: a failed row blocks even when counts are absent', () => {
  const checks = { typecheck: { status: 'pass' }, lint: { status: 'fail', errors: 0 }, tests: { status: 'pass' } };
  const findings = buildFindings({ review: BASE_REVIEW, triage: null, checks, visual: null, meta: META });
  assert.equal(findings.rubric[1].pass, false);
});
