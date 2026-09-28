// Renders both output formats from one findings.json data model, in the
// order that lets the HTML embed the markdown (for the copy button):
// markdown first, then HTML with that markdown text passed through.

import { renderMarkdown } from './render/md.mjs';
import { renderHtml } from './render/html.mjs';

export async function buildReport(findings) {
  const markdown = renderMarkdown(findings);
  const html = await renderHtml(findings, markdown);
  return { html, markdown };
}
