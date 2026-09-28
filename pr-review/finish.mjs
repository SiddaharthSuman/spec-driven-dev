// `finish` — the only command that writes report.html / report.md. Reads
// the agent's review.json plus the triage/checks/visual evidence,
// mechanically assembles findings.json, validates it, renders both report
// formats, and runs the quality gate against the rendered HTML. See
// README.md's "finish" section for exit codes and flags.

import path from 'node:path';
import fs from 'node:fs/promises';
import { unifiedDiff } from './lib/git.mjs';
import { buildFindings } from './assemble.mjs';
import { validate } from './schema.mjs';
import { buildReport } from './build-report.mjs';
import { runGate } from './quality-gate.mjs';

async function readJson(filePath) {
  if (!filePath) return null;
  return JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8'));
}

async function enrichDiffFiles(repo, paths, base, to) {
  const enriched = [];
  for (const filePath of (paths ?? []).slice(0, 3)) {
    try {
      const diffText = await unifiedDiff(repo, base, to, [filePath], 4);
      enriched.push({ path: filePath, diff: diffText });
    } catch (err) {
      enriched.push({ path: filePath, diff: `(could not read diff: ${err.message})` });
    }
  }
  return enriched;
}

export async function finish(args) {
  const repo = path.resolve(args.repo || process.cwd());
  const dir = path.resolve(args.dir);
  const required = ['pr', 'repoName', 'head', 'base', 'baseBranch', 'dir', 'review', 'triage', 'checks'];
  const missing = required.filter((key) => !args[key]);
  if (missing.length > 0) {
    console.error(`finish is missing required flags: ${missing.join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const [review, triage, checks, visual] = await Promise.all([
    readJson(args.review),
    readJson(args.triage),
    readJson(args.checks),
    args.visual ? readJson(args.visual) : Promise.resolve(null),
  ]);

  const meta = {
    pr: Number.parseInt(args.pr, 10),
    repo: args.repoName,
    head: args.head,
    merge: args.merge ?? 'none',
    base: args.base,
    baseBranch: args.baseBranch,
  };

  const findings = buildFindings({ review, triage, checks, visual, meta });

  const toSha = meta.merge !== 'none' ? meta.merge : meta.head;
  findings.diffFiles = await enrichDiffFiles(repo, review.changes?.diffFiles, meta.base, toSha);

  const { ok: schemaOk, errors: schemaErrors } = validate(findings);
  if (!schemaOk) {
    console.log(JSON.stringify({ ok: false, stage: 'schema', errors: schemaErrors }, null, 2));
    process.exitCode = 3;
    return;
  }

  await fs.mkdir(dir, { recursive: true });
  const { html, markdown } = await buildReport(findings);

  const htmlPath = path.join(dir, 'report.html');
  const mdPath = path.join(dir, 'report.md');
  await fs.writeFile(htmlPath, html);
  await fs.writeFile(mdPath, markdown);

  // Record the reviewed head SHA so a future `prepare` can skip a PR that
  // hasn't moved, unless --force is given.
  await fs.writeFile(
    path.join(dir, 'meta.json'),
    JSON.stringify({ headSha: meta.head, reviewedAt: new Date().toISOString() }, null, 2)
  );

  const gate = await runGate(htmlPath);
  if (!gate.ok) {
    console.log(JSON.stringify({ ok: false, stage: 'quality-gate', errors: gate.failures }, null, 2));
    process.exitCode = 2;
    return;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        decision: findings.decision,
        confidence: findings.confidence,
        blockingCount: findings.blockingCount,
        tier: findings.facts.sizeTier,
        coverage: findings.coverage,
        htmlPath,
        mdPath,
      },
      null,
      2
    )
  );
}
