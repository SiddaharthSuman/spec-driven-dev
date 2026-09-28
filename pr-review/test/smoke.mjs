// Maintainer utility — NOT part of the shipped test/*.check.mjs suite
// (`node --test` only picks up *.check.mjs). Regenerates golden/report.html,
// golden/report.md, and golden/findings.json from fixtures/. Run this
// deliberately, after confirming a golden diff is an intended rendering
// change and not a regression — test/render.check.mjs is what actually
// enforces golden parity on every run:
//
//   node test/smoke.mjs && git diff golden/
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildFindings } from '../assemble.mjs';
import { validate } from '../schema.mjs';
import { buildReport } from '../build-report.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const FIXTURES = path.join(HERE, '..', 'fixtures');

async function main() {
  const [review, triage, checks, visual] = await Promise.all([
    fs.readFile(path.join(FIXTURES, 'review.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'triage.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'checks.example.json'), 'utf8').then(JSON.parse),
    fs.readFile(path.join(FIXTURES, 'visual.example.json'), 'utf8').then(JSON.parse),
  ]);

  const meta = {
    pr: 812,
    repo: 'siddaharthsuman/example-app',
    head: '2222222222222222222222222222222222222222',
    merge: 'none',
    base: '1111111111111111111111111111111111111111',
    baseBranch: 'main',
  };

  const findings = buildFindings({ review, triage, checks, visual, meta });
  // Skip real git-diff enrichment in this smoke test (no repo on disk) —
  // finish.mjs does this step for real; here we just fabricate plausible
  // diff text so render/html.mjs has something to render.
  findings.diffFiles = review.changes.diffFiles.map((p) => ({
    path: p,
    diff: `--- a/${p}\n+++ b/${p}\n@@ -40,6 +40,7 @@\n-  return true;\n+  return start <= end;\n`,
  }));

  const { ok, errors } = validate(findings);
  console.log('schema valid:', ok);
  if (!ok) {
    console.log(errors);
    process.exitCode = 1;
    return;
  }

  const { html, markdown } = await buildReport(findings);

  const goldenDir = path.join(HERE, '..', 'golden');
  await fs.mkdir(goldenDir, { recursive: true });
  await fs.writeFile(path.join(goldenDir, 'report.html'), html);
  await fs.writeFile(path.join(goldenDir, 'report.md'), markdown);
  await fs.writeFile(path.join(goldenDir, 'findings.json'), JSON.stringify(findings, null, 2));

  console.log('wrote golden/report.html, golden/report.md, golden/findings.json');
  console.log('html length:', html.length, 'markdown length:', markdown.length);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
