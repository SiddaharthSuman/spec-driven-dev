// Renders the paste-ready markdown PR comment from the same findings.json
// data model report.html renders from — so the two can never disagree.

import { SEVERITY_LABEL, DECISION_LABEL, LENS_VERDICT_LABEL, VISUAL_STATUS_LABEL, shortSha } from './inline.mjs';

function renderRubric(rubric) {
  return rubric.map((row) => `- [${row.pass ? 'x' : ' '}] ${row.label}`).join('\n');
}

function renderLenses(lenses) {
  return Object.entries(lenses)
    .map(([name, [verdict, sentence]]) => `- **${name}**: ${LENS_VERDICT_LABEL[verdict] ?? verdict} — ${sentence}`)
    .join('\n');
}

function renderFindings(findings) {
  if (findings.length === 0) return '_No findings._';
  return findings
    .map((f) => {
      const lines = [`- **${f.id}** (${SEVERITY_LABEL[f.severity] ?? f.severity}): ${f.summary}`];
      if (f.detail) lines.push(`  ${f.detail}`);
      if (f.ref) lines.push(`  \`${f.ref}\``);
      return lines.join('\n');
    })
    .join('\n');
}

function renderVisual(visual) {
  const scenarios = visual?.scenarios ?? [];
  if (scenarios.length === 0) return '_No visual changes captured._';
  return scenarios
    .map((s) => `- **${s.name}**: ${VISUAL_STATUS_LABEL[s.status] ?? s.status}${s.note ? ` (${s.note})` : ''}`)
    .join('\n');
}

export function renderMarkdown(findings) {
  const parts = [];

  parts.push(
    `## PR #${findings.meta.pr} review — ${DECISION_LABEL[findings.decision] ?? findings.decision} (confidence ${findings.confidence}/5, risk ${findings.riskLevel}/3)`
  );
  parts.push('');
  parts.push(findings.lede);
  parts.push('');

  parts.push('### Verification');
  parts.push(renderRubric(findings.rubric));
  parts.push('');

  parts.push('### Lenses');
  parts.push(renderLenses(findings.lenses));
  parts.push('');

  parts.push(`### Findings (${findings.findings.length}, ${findings.blockingCount} blocking)`);
  parts.push(renderFindings(findings.findings));
  parts.push('');

  parts.push(
    `### Visual coverage${findings.coverage.visualPct !== null ? ` — ${findings.coverage.visualPct}% changed/new` : ''}`
  );
  parts.push(renderVisual(findings.visual));
  parts.push('');

  parts.push('### Spec');
  parts.push(findings.spec.linked ? `Linked: \`${findings.spec.path ?? ''}\`` : 'No linked spec found for this PR.');

  if (findings.notVerifiedExtra?.length) {
    parts.push('');
    parts.push('### Not independently verified');
    parts.push(findings.notVerifiedExtra.map((i) => `- ${i}`).join('\n'));
  }

  parts.push('');
  parts.push('---');
  parts.push(
    `_base \`${shortSha(findings.meta.baseSha)}\` · head \`${shortSha(findings.meta.headSha)}\`${
      findings.meta.mergeSha ? ` · merge \`${shortSha(findings.meta.mergeSha)}\`` : ''
    } · not posted automatically — paste this yourself._`
  );

  return parts.join('\n');
}
