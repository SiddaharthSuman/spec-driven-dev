// Merges the agent-authored review.json with the triage/checks/visual
// evidence into the full findings.json data model that render/ consumes.
// This is the "mechanical assembly" step `finish` calls — everything here
// is computed from evidence, nothing here is model judgment. See
// README.md's "finish" section and fixtures/review.example.json for the
// exact shape review.json must already match by the time it reaches here.

const RUBRIC_LABELS = [
  'No blocking finding',
  'Typecheck / lint / tests pass',
  'Small, single-purpose diff',
  'Reuses existing patterns',
  'No open user-visible inconsistency',
];

function checksAllPass(checks) {
  if (!checks) return null;
  return (checks.typecheck?.errors ?? 0) === 0 && (checks.lint?.errors ?? 0) === 0 && (checks.tests?.failed ?? 0) === 0;
}

function buildVerificationRows(review, checks) {
  const rubric = review.rubric ?? [];
  return RUBRIC_LABELS.map((label, i) => ({
    label,
    // The typecheck/lint/tests row is cross-checked against real evidence
    // rather than trusting the agent's own boolean for it, since that's
    // exactly the kind of fact code should confirm, not the model.
    pass: i === 1 && checks ? checksAllPass(checks) : Boolean(rubric[i]),
  }));
}

function buildCoverage(visual) {
  const scenarios = visual?.scenarios ?? [];
  const total = scenarios.length;
  const captured = scenarios.filter((s) => s.status === 'captured' || s.status === 'new').length;
  return {
    totalScenarios: total,
    capturedScenarios: captured,
    visualPct: total === 0 ? null : Math.round((captured / total) * 100),
  };
}

export function buildFindings({ review, triage, checks, visual, meta }) {
  const findings = review.findings ?? [];
  const blockingCount = findings.filter((f) => f.severity === 'blocking').length;

  return {
    meta: {
      pr: meta.pr,
      repo: meta.repo,
      headSha: meta.head,
      mergeSha: meta.merge && meta.merge !== 'none' ? meta.merge : null,
      baseSha: meta.base,
      baseBranch: meta.baseBranch,
      generatedAt: new Date().toISOString(),
    },
    decision: review.decision,
    confidence: review.confidence,
    riskLevel: review.riskLevel,
    lede: review.lede ?? '',
    rubric: buildVerificationRows(review, checks),
    lenses: review.lenses ?? {},
    findings,
    blockingCount,
    spec: review.spec ?? { linked: false, path: null },
    notVerifiedExtra: review.notVerifiedExtra ?? [],
    facts: {
      sizeTier: triage?.tier ?? null,
      reviewableLines: triage?.reviewableLines ?? null,
      changedFiles: triage?.totalFiles ?? null,
      excludedFiles: triage?.excludedFileCount ?? null,
      deepUnits: triage?.units?.deep?.length ?? null,
      skimmedUnits: triage?.units?.skimmed?.length ?? null,
    },
    checks: checks ?? null,
    coverage: buildCoverage(visual),
    visual: visual ?? null,
    diffFiles: review.changes?.diffFiles ?? [],
    flow: review.changes?.flow ?? null,
  };
}
