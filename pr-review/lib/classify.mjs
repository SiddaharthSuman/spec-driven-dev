// File classification and noise-exclusion rules shared by triage.mjs and
// diff.mjs, so a file excluded from the reviewable line count is the exact
// same file skipped when building a diff.

export const SENSITIVE_PATTERN = /(auth|security|permission|token|secret|credential)/i;

const LOCKFILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'npm-shrinkwrap.json',
]);

const GENERATED_PATTERN = /(^|\/)(dist|build|coverage|\.next|out)\//;
const SNAPSHOT_PATTERN = /__snapshots__\//;
const TEST_PATTERN = /(\.(test|spec)\.[jt]sx?$)|(^|\/)(__tests__|e2e)\//;
const DOC_PATTERN = /\.mdx?$|(^|\/)docs\//;
const STYLE_PATTERN = /\.(css|scss|less)$/;
const CONFIG_PATTERN = /\.(json|ya?ml|toml)$|(^|\/)\.[a-z]+rc(\.[a-z]+)?$/i;

export function basename(path) {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

export function fileKind(path) {
  if (GENERATED_PATTERN.test(path)) return 'generated';
  if (SNAPSHOT_PATTERN.test(path)) return 'generated';
  if (TEST_PATTERN.test(path)) return 'test';
  if (DOC_PATTERN.test(path)) return 'doc';
  if (STYLE_PATTERN.test(path)) return 'style';
  if (CONFIG_PATTERN.test(path)) return 'config';
  return 'source';
}

// True if this file should be excluded from the reviewable line count
// entirely (still listed, but never counted toward tiering or diffed in
// full). Whitespace-only-ness is caller-supplied, since it requires a
// second `git diff --ignore-all-space` numstat call to detect.
export function isNoise(entry, { whitespaceOnly = false } = {}) {
  if (entry.status === 'R' && entry.similarity >= 100) return true; // pure rename
  if (LOCKFILES.has(basename(entry.path))) return true;
  if (fileKind(entry.path) === 'generated') return true;
  if (whitespaceOnly) return true;
  return false;
}

// Groups changed files into review "units" — a coarse heuristic: the top
// two path segments (e.g. src/services/invoices.api.ts -> src/services),
// falling back to the top segment for shallow paths.
export function unitKey(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? path;
  return parts.slice(0, 2).join('/');
}

export function isSensitive(path) {
  return SENSITIVE_PATTERN.test(path);
}
