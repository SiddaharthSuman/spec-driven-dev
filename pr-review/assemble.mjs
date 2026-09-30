// Merges the agent-authored review.json with the triage/checks/visual
// evidence into the full findings.json data model that render/ consumes.
// This is the "mechanical assembly" step `finish` calls, everything here
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

const CHECK_ROWS = [
  ['typecheck', 'Typecheck'],
  ['lint', 'Lint'],
  ['tests', 'Tests'],
];

// A row passes only when its status says so. "preexisting" (the base checkout
// fails the same way) and "skipped" (nothing to run) do not block. "unknown"
// (could not run, timed out, unparsable) never counts as a pass. Rows written
// before statuses existed fall back to their counts.
function rowPasses(row) {
  if (!row) return true;
  if (row.status) return ['pass', 'skipped', 'preexisting'].includes(row.status);
  return (row.errors ?? 0) === 0 && (row.failed ?? 0) === 0;
}

function checksAllPass(checks) {
  if (!checks) return null;
  return CHECK_ROWS.every(([key]) => rowPasses(checks[key]));
}

// Lines for the "Not independently verified" list: every check that could
// not run, and every check that only passed because the base fails too.
export function checkCaveats(checks) {
  if (!checks) return [];
  const lines = [];
  for (const [key, label] of CHECK_ROWS) {
    const row = checks[key];
    if (!row) continue;
    if (row.status === 'unknown') lines.push(`${label} could not be verified: ${row.note ?? 'the command did not produce a usable result'}.`);
    if (row.status === 'preexisting') lines.push(`${label} reports ${row.errors ?? row.failed ?? 'some'} problem(s), but the base branch has the same or more, so they are not attributed to this PR.`);
    if (row.status === 'skipped' && row.note && row.note !== 'skipped by request') lines.push(`${label} did not run: ${row.note}.`);
  }
  return lines;
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
    notVerifiedExtra: [...(review.notVerifiedExtra ?? []), ...checkCaveats(checks)],
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
