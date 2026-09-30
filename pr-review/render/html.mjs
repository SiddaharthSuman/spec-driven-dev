// Renders report.html from the findings.json data model. By the time
// findings reaches here, `findings.diffFiles` has already been enriched by
// finish.mjs from [path, path, path] into [{path, diff}, ...] (up to 3),
// this module only renders, it never fetches anything itself.
//
// `markdownText` is the already-rendered report.md content, embedded in a
// hidden block so the copy button (report.js) can copy it verbatim.

import fs from 'node:fs/promises';
import path from 'node:path';
import {
  escapeHtml,
  SEVERITY_LABEL,
  DECISION_LABEL,
  LENS_VERDICT_LABEL,
  VISUAL_STATUS_LABEL,
  formatDate,
  shortSha,
} from './inline.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);

function decisionClass(decision) {
  return `badge-${decision.toLowerCase().replace(/\s+/g, '-')}`;
}

function renderRubric(rubric) {
  return rubric
    .map(
      (row) =>
        `<tr><td class="${row.pass ? 'check-yes' : 'check-no'}">${escapeHtml(row.label)}</td></tr>`
    )
    .join('\n');
}

function renderLenses(lenses) {
  return Object.entries(lenses)
    .map(
      ([name, [verdict, sentence]]) => `
      <tr>
        <td>${escapeHtml(name[0].toUpperCase() + name.slice(1))}</td>
        <td class="check-${verdict === 'pass' ? 'yes' : 'no'}">${escapeHtml(LENS_VERDICT_LABEL[verdict] ?? verdict)}</td>
        <td>${escapeHtml(sentence)}</td>
      </tr>`
    )
    .join('\n');
}

function renderFindings(findings) {
  if (findings.length === 0) return '<p class="muted">No findings.</p>';
  return findings
    .map(
      (f) => `
      <div class="finding" data-severity="${escapeHtml(f.severity)}">
        <span class="finding-id">${escapeHtml(f.id)}</span>
        <strong>${escapeHtml(SEVERITY_LABEL[f.severity] ?? f.severity)}</strong>
       : ${escapeHtml(f.summary)}
        ${f.detail ? `<div class="muted">${escapeHtml(f.detail)}</div>` : ''}
        ${f.ref ? `<div class="muted finding-id">${escapeHtml(f.ref)}</div>` : ''}
      </div>`
    )
    .join('\n');
}

function renderDiffFiles(diffFiles) {
  if (!diffFiles || diffFiles.length === 0) return '';
  return diffFiles
    .map(
      (d) => `
      <h3 class="muted">${escapeHtml(d.path)}</h3>
      <div class="diff-block">${escapeHtml(d.diff ?? '(diff unavailable)')}</div>`
    )
    .join('\n');
}

function renderVisual(visual) {
  const scenarios = visual?.scenarios ?? [];
  if (scenarios.length === 0) {
    return '<p class="muted">No visual changes captured (no UI files changed, or screenshots were disabled).</p>';
  }
  return scenarios
    .map((s) => {
      if (s.status === 'failed') {
        return `<div class="panel"><strong>${escapeHtml(s.name)}</strong>: <span class="check-no">failed</span>: ${escapeHtml(s.error ?? '')}</div>`;
      }
      return `
        <div class="panel">
          <strong>${escapeHtml(s.name)}</strong>
         : ${escapeHtml(VISUAL_STATUS_LABEL[s.status] ?? s.status)}
          ${s.note ? `<span class="muted">(${escapeHtml(s.note)})</span>` : ''}
          <div class="visual-grid">
            <figure><img src="${escapeHtml(s.basePath)}" alt="Base: ${escapeHtml(s.name)}" loading="lazy"><figcaption class="muted">Base</figcaption></figure>
            <figure><img src="${escapeHtml(s.headPath)}" alt="Head: ${escapeHtml(s.name)}" loading="lazy"><figcaption class="muted">Head</figcaption></figure>
          </div>
        </div>`;
    })
    .join('\n');
}

function renderList(items) {
  if (!items || items.length === 0) return '';
  return `<ul class="plain">${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul>`;
}

export async function renderHtml(findings, markdownText) {
  const [css, js] = await Promise.all([
    fs.readFile(path.join(HERE, 'report.css'), 'utf8'),
    fs.readFile(path.join(HERE, 'report.js'), 'utf8'),
  ]);

  const title = `PR #${findings.meta.pr} review: ${findings.meta.repo}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${css}</style>
</head>
<body>
  <div class="header">
    <h1 lang="en">PR #${findings.meta.pr}: ${escapeHtml(findings.meta.repo)}</h1>
    <span class="badge ${decisionClass(findings.decision)}">${escapeHtml(DECISION_LABEL[findings.decision] ?? findings.decision)}</span>
    <span class="muted">confidence ${findings.confidence}/5 &middot; risk ${findings.riskLevel}/3 &middot; tier ${escapeHtml(findings.facts.sizeTier ?? '?')}</span>
    <button id="theme-toggle" class="copy-btn" type="button">Toggle theme</button>
  </div>

  <p class="lede">${escapeHtml(findings.lede)}</p>

  <h2>Verification</h2>
  <table>${renderRubric(findings.rubric)}</table>

  <h2>Lenses</h2>
  <table>${renderLenses(findings.lenses)}</table>

  <h2>Findings (${findings.findings.length}, ${findings.blockingCount} blocking)</h2>
  ${renderFindings(findings.findings)}

  ${findings.diffFiles?.length ? `<h2>Key diffs</h2>${renderDiffFiles(findings.diffFiles)}` : ''}

  <h2>Visual coverage${findings.coverage.visualPct !== null ? `: ${findings.coverage.visualPct}% changed/new` : ''}</h2>
  ${renderVisual(findings.visual)}
  ${findings.visual?.tryIt?.length ? `<h3 class="muted">Try it yourself</h3>${renderList(findings.visual.tryIt)}` : ''}
  ${findings.visual?.knownLimits?.length ? `<h3 class="muted">Known limits</h3>${renderList(findings.visual.knownLimits)}` : ''}

  <h2>Spec</h2>
  <p>${findings.spec.linked ? `Linked: <code>${escapeHtml(findings.spec.path ?? '')}</code>` : '<span class="muted">No linked spec found for this PR.</span>'}</p>

  ${findings.notVerifiedExtra?.length ? `<h2>Not independently verified</h2>${renderList(findings.notVerifiedExtra)}` : ''}

  <h2>Paste-ready comment</h2>
  <button id="copy-md-btn" class="copy-btn" type="button">Copy markdown comment</button>
  <pre id="markdown-source" style="position:absolute;left:-9999px;top:-9999px;" aria-hidden="true">${escapeHtml(markdownText)}</pre>

  <footer>
    Generated ${formatDate(findings.meta.generatedAt)} &middot; base <code>${shortSha(findings.meta.baseSha)}</code> &middot;
    head <code>${shortSha(findings.meta.headSha)}</code>${findings.meta.mergeSha ? ` &middot; merge <code>${shortSha(findings.meta.mergeSha)}</code>` : ''} &middot;
    ${findings.facts.reviewableLines ?? '?'} reviewable lines across ${findings.facts.changedFiles ?? '?'} files
  </footer>

  <script>${js}</script>
</body>
</html>
`;
}
