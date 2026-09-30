// `checks` runs the project's real typecheck, lint and test commands against a
// checkout and reduces each to one compact row, so the calling agent never
// sees raw tool output. See README.md's "checks" section.
//
// Nothing here assumes one toolchain. Each check either runs a command the
// caller passed in (--typecheck-cmd, --lint-cmd, --test-cmd, usually copied
// from the project's AGENTS.md) or is detected from the checkout:
//
//   typecheck  tsc -b when tsconfig.json uses project references (a "solution
//              style" config, as Vite templates do), otherwise tsc --noEmit.
//              A plain tsc --noEmit on a solution-style config checks nothing
//              and exits 0, which is why it must not be used there.
//   lint       eslint (when an ESLint config exists) and biome (when a biome
//              config exists), on the changed files only.
//   tests      vitest or jest, else the package.json "test" script.
//
// Every row has a status:
//   pass         the command exited 0
//   fail         it found problems that the base checkout does not have
//   preexisting  it found problems, but the base has at least as many
//   unknown      it could not run or its output could not be trusted (missing
//                tool, timeout, crash, config error). Never counts as a pass.
//   skipped      nothing to run (no tsconfig, no test script, no lintable files)
//
// A row that fails on the head checkout is re-run on the base checkout so
// problems the PR did not introduce are labelled instead of blamed on it.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { run } from './lib/proc.mjs';
import { parseList } from './lib/args.mjs';

const DEFAULT_TIMEOUT_MIN = 10;
const SAMPLE_MAX = 5;
const LINE_MAX = 200;
const LINT_EXT = /\.(c|m)?(j|t)sx?$|\.vue$|\.svelte$/;
const TSC_ERROR_LINE = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;
const TSC_ANY_ERROR = /\berror (TS\d+)\b/;

// ------------------------------------------------------------------ parsers

export function parseTsc(text) {
  const errors = [];
  let other = 0;
  for (const line of text.split('\n')) {
    const m = line.match(TSC_ERROR_LINE);
    if (m) errors.push({ file: m[1], line: Number(m[2]), col: Number(m[3]), code: m[4], message: m[5] });
    else if (TSC_ANY_ERROR.test(line)) other += 1;
  }
  return { errors: errors.length, other, sample: errors.slice(0, SAMPLE_MAX) };
}

export function parseEslintJson(text) {
  let results;
  try {
    results = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(results)) return null;
  let errors = 0;
  let warnings = 0;
  const sample = [];
  for (const file of results) {
    for (const msg of file.messages ?? []) {
      if (msg.severity === 2) errors++;
      else warnings++;
      if (msg.severity === 2 && sample.length < SAMPLE_MAX) {
        sample.push({ file: file.filePath, line: msg.line, ruleId: msg.ruleId, message: msg.message });
      }
    }
  }
  return { errors, warnings, sample };
}

export function parseBiomeJson(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return null;
  }
  if (!report || !Array.isArray(report.diagnostics)) return null;
  const errors = report.diagnostics.filter((d) => d.severity === 'error');
  return {
    errors: report.summary?.errors ?? errors.length,
    warnings: report.summary?.warnings ?? 0,
    sample: errors.slice(0, SAMPLE_MAX).map((d) => ({
      file: d.location?.path,
      line: d.location?.start?.line,
      ruleId: d.category,
      message: d.message,
    })),
  };
}

// Vitest's and Jest's JSON reporters share one shape.
export function parseTestJson(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return null;
  }
  if (!report || typeof report !== 'object' || report.numTotalTests === undefined) return null;
  const failedTests = (report.testResults ?? [])
    .flatMap((suite) => suite.assertionResults ?? [])
    .filter((t) => t.status === 'failed');
  return {
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? failedTests.length,
    sample: failedTests.slice(0, SAMPLE_MAX).map((t) => ({
      name: t.fullName ?? t.title,
      message: (t.failureMessages ?? [])[0]?.split('\n')[0] ?? '',
    })),
  };
}

// For a command whose output format is unknown: a few trimmed lines, so a
// person can see why it failed without the whole log.
export function plainSample(text) {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const errorLines = lines.filter((l) => /\b(error|fail|failed)\b/i.test(l));
  return (errorLines.length > 0 ? errorLines : lines).slice(0, SAMPLE_MAX).map((l) => l.slice(0, LINE_MAX));
}

// --------------------------------------------------------------- detection

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function readText(p) {
  try {
    return await fs.readFile(p, 'utf8');
  } catch {
    return null;
  }
}

async function readPackageJson(dir) {
  const text = await readText(path.join(dir, 'package.json'));
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function hasBin(dir, name) {
  return exists(path.join(dir, 'node_modules', '.bin', name));
}

async function hasAny(dir, names) {
  for (const n of names) if (await exists(path.join(dir, n))) return true;
  return false;
}

// tsconfig.json may contain comments, so look for the key instead of parsing.
export function usesProjectReferences(tsconfigText) {
  return /"references"\s*:\s*\[\s*\{/.test(tsconfigText);
}

// A check is { key, tool, bin, args, parse, outFile? } plus, for caller-supplied
// commands, { custom: "<shell command>" }. Returns null when there is nothing
// to run, or { skipped: reason } / { unknown: reason } for a row with no run.
async function planTypecheck(head, cmd) {
  if (cmd) return { tool: 'typecheck', custom: cmd, parse: 'tsc' };
  const text = await readText(path.join(head, 'tsconfig.json'));
  if (text === null) return { skipped: 'no tsconfig.json in the checkout' };
  if (!(await hasBin(head, 'tsc'))) return { unknown: 'typescript is not installed in the checkout' };
  const solution = usesProjectReferences(text);
  return {
    tool: solution ? 'tsc -b' : 'tsc --noEmit',
    bin: 'tsc',
    args: solution ? ['-b', '--pretty', 'false'] : ['--noEmit', '--pretty', 'false'],
    parse: 'tsc',
  };
}

async function planLint(head, files, cmd) {
  if (cmd) return [{ tool: 'lint', custom: cmd, parse: 'plain' }];
  const lintable = [];
  for (const f of files) if (LINT_EXT.test(f) && (await exists(path.join(head, f)))) lintable.push(f);
  const plans = [];
  const pkg = await readPackageJson(head);
  const hasEslintConfig =
    (await hasAny(head, [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml',
    ])) || Boolean(pkg?.eslintConfig);
  const hasBiomeConfig = await hasAny(head, ['biome.json', 'biome.jsonc']);
  if (lintable.length === 0) return [{ skipped: 'no lintable files changed', tool: 'lint' }];
  if (hasEslintConfig) {
    plans.push(
      (await hasBin(head, 'eslint'))
        ? { tool: 'eslint', bin: 'eslint', args: ['--format', 'json', ...lintable], parse: 'eslint', files: lintable }
        : { tool: 'eslint', unknown: 'an ESLint config exists but eslint is not installed in the checkout' },
    );
  }
  if (hasBiomeConfig) {
    plans.push(
      (await hasBin(head, 'biome'))
        ? { tool: 'biome', bin: 'biome', args: ['check', '--reporter=json', ...lintable], parse: 'biome', files: lintable }
        : { tool: 'biome', unknown: 'a Biome config exists but biome is not installed in the checkout' },
    );
  }
  if (plans.length === 0) return [{ skipped: 'no ESLint or Biome config in the checkout', tool: 'lint' }];
  return plans;
}

async function planTests(head, cmd) {
  if (cmd) return { tool: 'tests', custom: cmd, parse: 'plain' };
  const pkg = await readPackageJson(head);
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const outFile = path.join(os.tmpdir(), `pr-review-tests-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  if ('vitest' in deps) {
    return (await hasBin(head, 'vitest'))
      ? { tool: 'vitest', bin: 'vitest', args: ['run', '--reporter=json', `--outputFile=${outFile}`], parse: 'tests', outFile }
      : { tool: 'vitest', unknown: 'vitest is listed in package.json but not installed in the checkout' };
  }
  if ('jest' in deps) {
    return (await hasBin(head, 'jest'))
      ? { tool: 'jest', bin: 'jest', args: ['--json', `--outputFile=${outFile}`], parse: 'tests', outFile }
      : { tool: 'jest', unknown: 'jest is listed in package.json but not installed in the checkout' };
  }
  if (pkg?.scripts?.test) return { tool: 'npm test', custom: 'npm test --silent', parse: 'plain' };
  return { skipped: 'no test runner or test script found' };
}

// --------------------------------------------------------------- execution

function commandLine(plan) {
  return plan.custom ?? [plan.bin, ...plan.args].join(' ');
}

async function execute(plan, dir, timeoutMs) {
  const opts = { cwd: dir, timeoutMs };
  if (plan.custom) return run('sh', ['-c', plan.custom], opts);
  return run(path.join(dir, 'node_modules', '.bin', plan.bin), plan.args, opts);
}

// Turns a finished process into { status, counts, sample, note }. Exit code is
// the source of truth for pass/fail. Parsed counts only add detail, and a
// parse failure on a non-zero exit is "unknown", never a pass.
async function interpret(plan, result, timeoutMin) {
  const out = `${result.stdout}\n${result.stderr}`;
  if (result.timedOut) return { status: 'unknown', note: `timed out after ${timeoutMin} min` };
  if (result.error || result.code === 127) {
    return { status: 'unknown', note: `could not start: ${String(result.error?.message ?? result.stderr).split('\n')[0].slice(0, LINE_MAX)}` };
  }

  if (plan.parse === 'tsc') {
    const t = parseTsc(out);
    if (result.code === 0) return { status: 'pass', errors: 0, sample: [] };
    if (t.errors > 0) return { status: 'fail', errors: t.errors, sample: t.sample };
    return { status: 'unknown', note: `exit ${result.code} with no parsable errors`, sample: plainSample(out) };
  }

  if (plan.parse === 'eslint') {
    const l = parseEslintJson(result.stdout);
    if (!l) return { status: 'unknown', note: `eslint exit ${result.code} with no JSON output`, sample: plainSample(out) };
    if (result.code === 0 || (result.code === 1 && l.errors === 0)) return { status: 'pass', ...l };
    if (result.code === 1) return { status: 'fail', ...l };
    return { status: 'unknown', note: `eslint exit ${result.code}`, sample: plainSample(out) };
  }

  if (plan.parse === 'biome') {
    const b = parseBiomeJson(result.stdout);
    if (result.code === 0) return { status: 'pass', errors: b?.errors ?? 0, warnings: b?.warnings ?? 0, sample: [] };
    if (b && b.errors > 0) return { status: 'fail', ...b };
    return { status: 'unknown', note: `biome exit ${result.code} with no parsable errors`, sample: plainSample(out) };
  }

  if (plan.parse === 'tests') {
    const text = plan.outFile ? ((await readText(plan.outFile)) ?? result.stdout) : result.stdout;
    if (plan.outFile) await fs.rm(plan.outFile, { force: true });
    const t = parseTestJson(text);
    if (result.code === 0) return { status: 'pass', passed: t?.passed ?? null, failed: 0, sample: [] };
    if (t && t.failed > 0) return { status: 'fail', ...t };
    return { status: 'unknown', note: `exit ${result.code} with no failing tests reported`, sample: plainSample(out) };
  }

  // plain: a caller-supplied command whose output format is unknown.
  if (result.code === 0) return { status: 'pass', sample: [] };
  return { status: 'fail', sample: plainSample(out) };
}

function countOf(interp) {
  if (typeof interp.errors === 'number') return interp.errors;
  if (typeof interp.failed === 'number') return interp.failed;
  return null;
}

async function runPlan(plan, head, base, timeoutMin) {
  if (plan.skipped) return { tool: plan.tool, status: 'skipped', note: plan.skipped };
  if (plan.unknown) return { tool: plan.tool, status: 'unknown', note: plan.unknown };

  const timeoutMs = timeoutMin * 60 * 1000;
  const result = await execute(plan, head, timeoutMs);
  const interp = await interpret(plan, result, timeoutMin);
  const row = { tool: plan.tool, command: commandLine(plan), exitCode: result.code, ...interp };

  // Only a failure with a trustworthy count is compared against base. A
  // failure with no count stays a failure.
  const headCount = countOf(interp);
  if (interp.status === 'fail' && base && headCount !== null && plan.parse !== 'plain') {
    const basePlan = { ...plan, args: plan.files ? swapFiles(plan, await existingIn(base, plan.files)) : plan.args };
    const skipBase = plan.files && basePlan.args.length === (plan.args.length - plan.files.length);
    const baseResult = skipBase ? null : await execute(basePlan, base, timeoutMs);
    const baseInterp = baseResult ? await interpret(basePlan, baseResult, timeoutMin) : null;
    const baseCount = baseInterp ? countOf(baseInterp) : null;
    if (baseInterp && baseInterp.status === 'fail' && baseCount !== null) {
      row.baseErrors = baseCount;
      if (headCount <= baseCount) row.status = 'preexisting';
    } else if (baseInterp && baseInterp.status === 'pass') {
      row.baseErrors = 0;
    }
  }
  return row;
}

async function existingIn(dir, files) {
  const kept = [];
  for (const f of files) if (await exists(path.join(dir, f))) kept.push(f);
  return kept;
}

function swapFiles(plan, kept) {
  const flags = plan.args.slice(0, plan.args.length - plan.files.length);
  return [...flags, ...kept];
}

// Merge several lint rows (eslint and biome) into the single `lint` row the
// report consumes: the worst status wins, counts add up.
function mergeLint(rows) {
  if (rows.length === 1) return rows[0];
  const rank = { fail: 4, unknown: 3, preexisting: 2, pass: 1, skipped: 0 };
  const worst = rows.reduce((a, b) => (rank[b.status] > rank[a.status] ? b : a));
  return {
    tool: rows.map((r) => r.tool).join(' + '),
    command: rows.map((r) => r.command).filter(Boolean).join(' && '),
    status: worst.status,
    errors: rows.reduce((n, r) => n + (r.errors ?? 0), 0),
    warnings: rows.reduce((n, r) => n + (r.warnings ?? 0), 0),
    sample: rows.flatMap((r) => r.sample ?? []).slice(0, SAMPLE_MAX),
    note: rows.map((r) => (r.note ? `${r.tool}: ${r.note}` : null)).filter(Boolean).join('; ') || undefined,
  };
}

// Exposed for tests: runs the three checks and returns the full result object.
export async function runChecks({ head, base = null, files = [], typecheckCmd, lintCmd, testCmd, skip = [], timeoutMin = DEFAULT_TIMEOUT_MIN }) {
  const skipped = new Set(skip);
  const skippedRow = (tool) => ({ tool, status: 'skipped', note: 'skipped by request' });

  const [typecheck, lint, tests] = await Promise.all([
    skipped.has('typecheck') ? skippedRow('typecheck') : planTypecheck(head, typecheckCmd).then((p) => runPlan(p, head, base, timeoutMin)),
    skipped.has('lint')
      ? skippedRow('lint')
      : planLint(head, files, lintCmd).then(async (plans) => mergeLint(await Promise.all(plans.map((p) => runPlan(p, head, base, timeoutMin))))),
    skipped.has('tests') ? skippedRow('tests') : planTests(head, testCmd).then((p) => runPlan(p, head, base, timeoutMin)),
  ]);

  return { head, base, filesChecked: files.length, typecheck, lint, tests };
}

export async function checks(args) {
  const { head, base } = args;
  if (!head) {
    console.error('checks requires --head (and usually --base, --files)');
    process.exitCode = 1;
    return;
  }
  const timeoutMin = args.timeoutMin ? Number.parseFloat(args.timeoutMin) : DEFAULT_TIMEOUT_MIN;
  const result = await runChecks({
    head,
    base: base ?? null,
    files: parseList(args.files),
    typecheckCmd: typeof args.typecheckCmd === 'string' ? args.typecheckCmd : undefined,
    lintCmd: typeof args.lintCmd === 'string' ? args.lintCmd : undefined,
    testCmd: typeof args.testCmd === 'string' ? args.testCmd : undefined,
    skip: parseList(args.skip),
    timeoutMin: Number.isFinite(timeoutMin) && timeoutMin > 0 ? timeoutMin : DEFAULT_TIMEOUT_MIN,
  });
  console.log(JSON.stringify(result));
}
