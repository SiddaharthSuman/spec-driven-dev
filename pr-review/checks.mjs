// `checks` — real typecheck/lint/test runs against the changed-file list,
// parsed down to compact rows so the calling agent never sees raw tool
// output. See README.md's "checks" section. Runs against the target stack
// this package assumes: TypeScript + ESLint + Vitest + pnpm.

import { run } from './lib/proc.mjs';
import { parseList } from './lib/args.mjs';

const TSC_ERROR_PATTERN = /^(.+?)\((\d+),(\d+)\): error (TS\d+): (.+)$/;

function parseTsc(stdout) {
  const lines = stdout.split('\n').filter(Boolean);
  const errors = [];
  for (const line of lines) {
    const match = line.match(TSC_ERROR_PATTERN);
    if (match) {
      const [, file, lineNo, col, code, message] = match;
      errors.push({ file, line: Number(lineNo), col: Number(col), code, message });
    }
  }
  return { errors: errors.length, sample: errors.slice(0, 5) };
}

function parseEslintJson(stdout) {
  let results;
  try {
    results = JSON.parse(stdout);
  } catch {
    return { errors: 0, warnings: 0, sample: [], parseError: true };
  }
  let errors = 0;
  let warnings = 0;
  const sample = [];
  for (const file of results) {
    for (const msg of file.messages) {
      if (msg.severity === 2) errors++;
      else warnings++;
      if (sample.length < 5) {
        sample.push({
          file: file.filePath,
          line: msg.line,
          ruleId: msg.ruleId,
          message: msg.message,
          severity: msg.severity === 2 ? 'error' : 'warning',
        });
      }
    }
  }
  return { errors, warnings, sample };
}

function parseVitestJson(stdout) {
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    return { passed: 0, failed: 0, sample: [], parseError: true };
  }
  const failedTests = (report.testResults ?? [])
    .flatMap((suite) => suite.assertionResults ?? [])
    .filter((t) => t.status === 'failed');
  return {
    passed: report.numPassedTests ?? 0,
    failed: report.numFailedTests ?? failedTests.length,
    sample: failedTests.slice(0, 5).map((t) => ({
      name: t.fullName ?? t.title,
      message: (t.failureMessages ?? [])[0]?.split('\n')[0] ?? '',
    })),
  };
}

export async function checks(args) {
  const { head, base } = args;
  const files = parseList(args.files);
  if (!head) {
    console.error('checks requires --head (and --base, --files)');
    process.exitCode = 1;
    return;
  }

  const [typecheckResult, lintResult, testResult] = await Promise.all([
    run('npx', ['tsc', '--noEmit'], { cwd: head }),
    files.length > 0
      ? run('npx', ['eslint', '--format', 'json', ...files], { cwd: head })
      : Promise.resolve({ ok: true, stdout: '[]', stderr: '' }),
    run('npx', ['vitest', 'run', '--reporter=json'], { cwd: head }),
  ]);

  const typecheck = parseTsc(typecheckResult.stdout || typecheckResult.stderr);
  const lint = parseEslintJson(lintResult.stdout);
  const tests = parseVitestJson(testResult.stdout);

  console.log(
    JSON.stringify({
      head,
      base: base ?? null,
      filesChecked: files.length,
      typecheck,
      lint,
      tests,
    })
  );
}
