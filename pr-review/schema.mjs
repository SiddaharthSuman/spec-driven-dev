// Hand-rolled findings.json validator: no external schema library
// dependency, deliberately, to match this package's zero-runtime-dep
// stance for its own plumbing (Playwright/TypeScript are the only real
// dependencies, and both are already required for capture/routes).

const DECISIONS = new Set(['Approve', 'Request changes', 'Comment']);
const SEVERITIES = new Set(['blocking', 'high', 'medium', 'low', 'trivial']);
const LENS_NAMES = ['correctness', 'security', 'simplicity', 'accessibility', 'consistency'];
const LENS_VERDICTS = new Set(['pass', 'note', 'fail']);

function isString(v) {
  return typeof v === 'string';
}

export function validate(findings) {
  const errors = [];
  const require = (cond, message) => {
    if (!cond) errors.push(message);
  };

  require(findings && typeof findings === 'object', 'findings must be an object');
  if (!findings || typeof findings !== 'object') return { ok: false, errors };

  require(findings.meta && typeof findings.meta === 'object', 'meta is required');
  if (findings.meta) {
    require(Number.isInteger(findings.meta.pr), 'meta.pr must be an integer');
    require(isString(findings.meta.repo), 'meta.repo must be a string');
    require(isString(findings.meta.headSha), 'meta.headSha must be a string');
    require(isString(findings.meta.baseSha), 'meta.baseSha must be a string');
  }

  require(DECISIONS.has(findings.decision), `decision must be one of ${[...DECISIONS].join('/')}`);
  require(
    Number.isInteger(findings.confidence) && findings.confidence >= 1 && findings.confidence <= 5,
    'confidence must be an integer 1-5'
  );
  require(
    Number.isInteger(findings.riskLevel) && findings.riskLevel >= 1 && findings.riskLevel <= 3,
    'riskLevel must be an integer 1-3'
  );

  require(Array.isArray(findings.rubric) && findings.rubric.length === 5, 'rubric must have exactly 5 entries');
  for (const row of findings.rubric ?? []) {
    require(isString(row?.label) && typeof row?.pass === 'boolean', 'each rubric entry needs a label and a boolean pass');
  }

  require(findings.lenses && typeof findings.lenses === 'object', 'lenses is required');
  for (const name of LENS_NAMES) {
    const entry = findings.lenses?.[name];
    require(Array.isArray(entry) && entry.length === 2, `lenses.${name} must be a [verdict, sentence] pair`);
    if (Array.isArray(entry)) {
      require(LENS_VERDICTS.has(entry[0]), `lenses.${name}[0] must be pass/note/fail`);
      require(isString(entry[1]), `lenses.${name}[1] must be a sentence`);
    }
  }

  require(Array.isArray(findings.findings), 'findings must be an array');
  for (const f of findings.findings ?? []) {
    require(isString(f.id), 'each finding needs an id');
    require(SEVERITIES.has(f.severity), `finding ${f.id ?? '?'} has an invalid severity`);
    require(isString(f.summary), `finding ${f.id ?? '?'} needs a summary`);
  }

  // Decision/finding-severity consistency: this is exactly the rule
  // review.json is supposed to already follow; catching a violation here
  // is a real regression, not a style nit.
  const hasBlocking = (findings.findings ?? []).some((f) => f.severity === 'blocking');
  if (findings.decision === 'Approve') {
    require(!hasBlocking, 'decision is Approve but a blocking finding exists');
  }
  if (hasBlocking) {
    require(findings.decision === 'Request changes', 'a blocking finding exists but decision is not "Request changes"');
  }

  require(findings.spec && typeof findings.spec === 'object', 'spec is required');
  if (findings.spec) {
    require(typeof findings.spec.linked === 'boolean', 'spec.linked must be a boolean');
  }

  require(findings.facts && typeof findings.facts === 'object', 'facts is required');
  require(findings.coverage && typeof findings.coverage === 'object', 'coverage is required');
  require(Array.isArray(findings.diffFiles) && findings.diffFiles.length <= 3, 'diffFiles must be an array of at most 3 entries');

  return { ok: errors.length === 0, errors };
}
