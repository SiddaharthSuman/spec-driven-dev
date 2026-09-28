// Small shared helpers used by both render/html.mjs and render/md.mjs, so
// labels and badge text can never drift between the two output formats.

export function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export const SEVERITY_LABEL = {
  blocking: 'Blocking',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  trivial: 'Trivial',
};

export const DECISION_LABEL = {
  Approve: 'Approve',
  'Request changes': 'Request changes',
  Comment: 'Comment',
};

export const LENS_VERDICT_LABEL = {
  pass: 'Pass',
  note: 'Note',
  fail: 'Fail',
};

export const VISUAL_STATUS_LABEL = {
  captured: 'Changed',
  unchanged: 'Unchanged',
  new: 'New',
  failed: 'Failed',
  unreliable: 'Unreliable',
};

export function formatDate(iso) {
  try {
    return new Date(iso).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  } catch {
    return iso ?? '';
  }
}

export function shortSha(sha) {
  return sha ? String(sha).slice(0, 8) : '';
}
