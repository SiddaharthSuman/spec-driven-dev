#!/usr/bin/env node
// AI-marker sanitizer for code and config files. Zero dependencies, ASCII-only
// source (special characters are written as \u escapes so this file passes its
// own check).
//
// Usage:
//   node sanitize.mjs [--check] [--staged] [--json] [--quiet] <path...>
//   node sanitize.mjs --hook     (PostToolUse hook: reads hook JSON on stdin)
//
// Default mode fixes what can be fixed mechanically, in place. Anything that
// needs a human (a sentence to rephrase) is reported, never rewritten.
// --check changes nothing and exits 1 if any file would change or has reports.
//
// Scope: code and config files that ship functionality (JS/TS, JSON, CSS,
// YAML, TOML, shell, HTML/SVG/XML). Markdown and .txt are never touched.
// The codebase is plain ASCII English typed on a US keyboard, so any non-ASCII
// character that survives the fixes below is reported.
//
// Fixed in place:
//   hidden         zero-width, bidi, soft hyphen, variation selectors, tag
//                  characters, control characters
//   spaces         non-breaking and other unusual spaces -> plain space
//   lookalikes     Cyrillic/Greek/fullwidth/ligature/math-alphabet letters and
//                  hyphen or minus lookalikes -> ASCII
//   quotes         curly quotes -> straight, escaped correctly inside strings
//   ellipsis       single-character ellipsis -> three dots
//   trailing       trailing spaces and tabs
//   asterisks      markdown bold/italic markers in code comments and prose-like
//                  JSON string values
//   headings       markdown heading hashes at the start of a code comment
//   normalization  Unicode NFC
//
// Reported, not rewritten:
//   em and en dashes (the sentence has to be rephrased; a hyphen swap only
//   hides the tell), and any other non-ASCII character, including curly quotes
//   found outside comments and strings.
//
// Opt-outs for intentional cases such as a Unicode test fixture: put the ignore
// marker (the words sanitize, ignore and file joined by hyphens) in a comment
// within the first 5 lines of the file, or list a path or glob in
// .sanitizeignore at the repo root.
//
// Code string literals are never stripped of asterisks (globs like
// "src/**/*.ts" are legitimate); prose-looking ones are reported instead.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// ---------------------------------------------------------------- profiles

const EXT_PROFILE = {
  '.js': 'js', '.jsx': 'js', '.ts': 'js', '.tsx': 'js', '.mjs': 'js',
  '.cjs': 'js', '.mts': 'js', '.cts': 'js',
  '.json': 'json', '.jsonc': 'json', '.json5': 'json',
  '.css': 'css', '.scss': 'css', '.less': 'css',
  '.yml': 'hash', '.yaml': 'hash', '.toml': 'hash', '.sh': 'hash',
  '.html': 'careful', '.htm': 'careful', '.svg': 'careful', '.xml': 'careful',
};

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'playwright-report',
  'test-results', 'storybook-static', '.next', '.turbo', '.engineer',
]);
const SKIP_FILE_RE =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|npm-shrinkwrap\.json)$|\.min\.(js|css)$|\.snap$/;
const IGNORE_MARKER = ['sanitize', 'ignore', 'file'].join('-');

export function profileFor(filePath) {
  const p = filePath.split(path.sep).join('/');
  if (SKIP_FILE_RE.test(p)) return null;
  return EXT_PROFILE[path.extname(p).toLowerCase()] ?? null;
}

// .sanitizeignore: one path or glob per line, # for comments
function globToRegex(glob) {
  const g = glob.replace(/^\.\//, '').replace(/^\//, '');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$|^${re}/`);
}

const ignoreCache = new Map();
function loadIgnore(root) {
  if (ignoreCache.has(root)) return ignoreCache.get(root);
  let rules = [];
  try {
    rules = fs.readFileSync(path.join(root, '.sanitizeignore'), 'utf8')
      .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map(globToRegex);
  } catch { /* no ignore file */ }
  ignoreCache.set(root, rules);
  return rules;
}

export function isIgnored(filePath, root = process.cwd()) {
  const rel = path.relative(root, path.resolve(root, filePath)).split(path.sep).join('/');
  if (rel.startsWith('..')) return false;
  return loadIgnore(root).some((re) => re.test(rel));
}

function hasIgnoreMarker(text) {
  return text.split('\n', 5).some((line) => line.includes(IGNORE_MARKER));
}

// -------------------------------------------------------------- character sets

const HIDDEN_RE =
  /[\u00AD\u034F\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFE00-\uFE0F\u{E0000}-\u{E007F}]/gu;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const LINE_SEP_RE = /[\u2028\u2029]/g;

const SPACE_RE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000]/g;

const FULLWIDTH_RE = /[\uFF01-\uFF5E]/g;
const MATH_ALNUM_RE = /[\u{1D400}-\u{1D7FF}]/gu;
const LIGATURES = {
  '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi',
  '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st',
};
const LIGATURE_RE = /[\uFB00-\uFB06]/g;
const HYPHEN_LOOKALIKE_RE = /[\u2010\u2011\u2012\u2212\uFE58\uFE63]/g;

// Cyrillic and Greek letters that render like Latin ones. The codebase is
// English ASCII, so these are replaced everywhere in code files.
const CONFUSABLES = {
  '\u0410': 'A', '\u0412': 'B', '\u0415': 'E', '\u041A': 'K', '\u041C': 'M',
  '\u041D': 'H', '\u041E': 'O', '\u0420': 'P', '\u0421': 'C', '\u0422': 'T',
  '\u0425': 'X', '\u0430': 'a', '\u0435': 'e', '\u043E': 'o', '\u0440': 'p',
  '\u0441': 'c', '\u0443': 'y', '\u0445': 'x', '\u0455': 's', '\u0456': 'i',
  '\u0458': 'j', '\u04BB': 'h',
  '\u0391': 'A', '\u0392': 'B', '\u0395': 'E', '\u0396': 'Z', '\u0397': 'H',
  '\u0399': 'I', '\u039A': 'K', '\u039C': 'M', '\u039D': 'N', '\u039F': 'O',
  '\u03A1': 'P', '\u03A4': 'T', '\u03A5': 'Y', '\u03A7': 'X', '\u03BF': 'o',
  '\u03BD': 'v',
};
const CONFUSABLE_RE = new RegExp(`[${Object.keys(CONFUSABLES).join('')}]`, 'g');

const CURLY_SQ = /[\u2018\u2019\u201A\u201B\u2032\u02BC]/g;
const CURLY_DQ = /[\u201C\u201D\u201E\u201F\u2033]/g;
const CURLY_ONE = /[\u2018\u2019\u201A\u201B\u2032\u02BC\u201C\u201D\u201E\u201F\u2033]/;
const DASH_ONE = /[\u2013\u2014\u2015\u2E3A\u2E3B]/;

// ------------------------------------------------------------------ helpers

function makeCounter() {
  const changes = {
    hidden: 0, spaces: 0, lookalikes: 0, quotes: 0, ellipsis: 0, trailing: 0,
    asterisks: 0, headings: 0, normalization: 0,
  };
  return { changes, bump: (k, n = 1) => { changes[k] += n; } };
}

function countingReplace(text, re, repl, key, bump) {
  return text.replace(re, (...args) => {
    bump(key);
    return typeof repl === 'function' ? repl(...args) : repl;
  });
}

// ------------------------------------------------- whole-file character rules

function universalRules(text, bump) {
  text = countingReplace(text, LINE_SEP_RE, '\n', 'hidden', bump);
  text = countingReplace(text, HIDDEN_RE, '', 'hidden', bump);
  text = countingReplace(text, CONTROL_RE, '', 'hidden', bump);

  text = countingReplace(text, SPACE_RE, ' ', 'spaces', bump);

  text = countingReplace(text, FULLWIDTH_RE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0), 'lookalikes', bump);
  text = countingReplace(text, LIGATURE_RE, (c) => LIGATURES[c], 'lookalikes', bump);
  text = countingReplace(text, MATH_ALNUM_RE, (c) => c.normalize('NFKC'), 'lookalikes', bump);
  text = countingReplace(text, CONFUSABLE_RE, (c) => CONFUSABLES[c], 'lookalikes', bump);
  text = countingReplace(text, HYPHEN_LOOKALIKE_RE, '-', 'lookalikes', bump);

  text = countingReplace(text, /[\u2026\u22EF]/g, '...', 'ellipsis', bump);
  return text;
}

// ----------------------------------------------------------------- quotes

// mode: 'free' (no escaping), 'dq' (inside a "..." string), 'sq' (inside '...')
function fixQuotes(s, mode, bump) {
  const sq = mode === 'sq' ? "\\'" : "'";
  const dq = mode === 'dq' ? '\\"' : '"';
  s = s.replace(CURLY_SQ, () => { bump('quotes'); return sq; });
  s = s.replace(CURLY_DQ, () => { bump('quotes'); return dq; });
  return s;
}

// ------------------------------------------------------- markdown-in-prose

function stripMarkdownProse(body, bump, { headings }) {
  const spans = [];
  let s = body.replace(/`[^`\n]*`/g, (m) => { spans.push(m); return `\u0000${spans.length - 1}\u0000`; });

  if (headings) {
    s = s.replace(/^(\s*)(?:#{2,6}[ \t]+|#[ \t]+(?=[A-Z]))/, (m, ws) => { bump('headings'); return ws; });
  }
  s = s.replace(/\*\*(?=\S)([^*\n]*?\S)\*\*/g, (m, inner) => {
    if (/[\/\\]/.test(inner)) return m;
    bump('asterisks');
    return inner;
  });
  s = s.replace(/(?<![\w*\\\/])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g, (m, inner) => {
    if (/[\/\\]/.test(inner) || inner.startsWith('.')) return m;
    bump('asterisks');
    return inner;
  });
  s = s.replace(/^(\s*)\*[ \t]+(?=\S)/, (m, ws) => { bump('asterisks'); return `${ws}- `; });

  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => spans[Number(i)]);
}

function proseLine(body, bump, { headings = true } = {}) {
  return fixQuotes(stripMarkdownProse(body, bump, { headings }), 'free', bump);
}

function looksLikeProse(inner) {
  return /\s/.test(inner) && /[A-Za-z]{2}/.test(inner) && !/[\/\\]/.test(inner);
}

// ---------------------------------------------------- JS / JSON / CSS scanner

function endOfString(t, i, q) {
  for (let j = i + 1; j < t.length; j++) {
    const c = t[j];
    if (c === '\\') { j++; continue; }
    if (c === q) return j + 1;
    if (c === '\n') return -1;
  }
  return -1;
}

function skipTemplate(t, i) {
  let j = i + 1;
  while (j < t.length) {
    const c = t[j];
    if (c === '\\') { j += 2; continue; }
    if (c === '`') return j + 1;
    if (c === '$' && t[j + 1] === '{') {
      j = skipBraces(t, j + 2);
      if (j < 0) return -1;
      continue;
    }
    j++;
  }
  return -1;
}

function skipBraces(t, j) {
  let depth = 1;
  while (j < t.length) {
    const c = t[j];
    if (c === '"' || c === "'") { const e = endOfString(t, j, c); j = e > 0 ? e : j + 1; continue; }
    if (c === '`') { const e = skipTemplate(t, j); if (e < 0) return -1; j = e; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return j + 1; }
    j++;
  }
  return -1;
}

const REGEX_PREV = new Set(['', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '>', '~', '^']);

function endOfRegex(t, i) {
  let inClass = false;
  for (let j = i + 1; j < t.length; j++) {
    const c = t[j];
    if (c === '\n') return -1;
    if (c === '\\') { j++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      let k = j + 1;
      while (k < t.length && /[a-z]/i.test(t[k])) k++;
      return k;
    }
  }
  return -1;
}

function scanCode(text, { lineComments, templates, regex }) {
  const segs = [];
  const n = text.length;
  let i = 0;
  let codeStart = 0;
  let lastSig = '';
  const flush = (end) => { if (end > codeStart) segs.push({ kind: 'code', raw: text.slice(codeStart, end) }); };
  const push = (kind, start, end, extra = {}) => {
    flush(start);
    segs.push({ kind, raw: text.slice(start, end), ...extra });
    codeStart = end;
  };
  while (i < n) {
    const c = text[i];
    const d = text[i + 1];
    if (lineComments && c === '/' && d === '/') {
      let j = text.indexOf('\n', i);
      if (j < 0) j = n;
      push('lcomment', i, j);
      i = j;
      continue;
    }
    if (c === '/' && d === '*') {
      let j = text.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      push('bcomment', i, j);
      i = j;
      continue;
    }
    if (c === '"' || c === "'") {
      const j = endOfString(text, i, c);
      if (j > 0) { push('string', i, j, { q: c }); lastSig = c; i = j; continue; }
      lastSig = c; i++; continue;
    }
    if (templates && c === '`') {
      const j = skipTemplate(text, i);
      if (j > 0) { push('string', i, j, { q: '`' }); lastSig = '`'; i = j; continue; }
      lastSig = c; i++; continue;
    }
    if (regex && c === '/' && REGEX_PREV.has(lastSig)) {
      const j = endOfRegex(text, i);
      if (j > 0) { i = j; lastSig = ')'; continue; }
    }
    if (!/\s/.test(c)) lastSig = c;
    i++;
  }
  flush(n);
  return segs;
}

function processBlockComment(raw, bump) {
  const lines = raw.split('\n');
  return lines.map((line, i) => {
    let head = '';
    let tail = '';
    let body = line;
    if (i === 0) {
      const m = /^\/\*+/.exec(body);
      head = m ? m[0] : '';
      body = body.slice(head.length);
    } else {
      const m = /^[ \t]*\*+(?!\/)[ \t]?/.exec(body);
      if (m) { head = m[0]; body = body.slice(head.length); }
    }
    if (i === lines.length - 1) {
      const m = /\*+\/$/.exec(body);
      if (m) { tail = m[0]; body = body.slice(0, body.length - tail.length); }
    }
    return head + proseLine(body, bump) + tail;
  }).join('\n');
}

function processScannedFile(text, profile, bump, review) {
  const segs = scanCode(text, {
    lineComments: profile !== 'css',
    templates: profile === 'js',
    regex: profile === 'js',
  });
  return segs.map((seg) => {
    if (seg.kind === 'lcomment') {
      const m = /^\/\/+/.exec(seg.raw);
      return m[0] + proseLine(seg.raw.slice(m[0].length), bump);
    }
    if (seg.kind === 'bcomment') return processBlockComment(seg.raw, bump);
    if (seg.kind === 'string') {
      const open = seg.raw[0];
      const closed = seg.raw.length >= 2 && seg.raw.endsWith(open);
      const inner = closed ? seg.raw.slice(1, -1) : seg.raw.slice(1);
      const tail = closed ? open : '';
      let out = inner;
      if (profile === 'json' && looksLikeProse(out)) out = stripMarkdownProse(out, bump, { headings: false });
      const mode = open === '"' ? 'dq' : open === "'" ? 'sq' : 'free';
      out = fixQuotes(out, mode, bump);
      if (profile === 'js' && looksLikeProse(out) && /\*\*\S[^*\n]*\S\*\*/.test(out)) {
        review.push({ message: 'markdown bold markers inside a string literal, fix by hand', sample: out.slice(0, 60) });
      }
      return open + out + tail;
    }
    return seg.raw;
  }).join('');
}

// ------------------------------------------------------------- hash profile

function processHash(text, bump) {
  return text.split('\n').map((line) => {
    let q = null;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '\\' && q === '"') i++; else if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
        const m = /^#+/.exec(line.slice(i));
        const head = m[0];
        return line.slice(0, i) + head + proseLine(line.slice(i + head.length), bump, { headings: false });
      }
    }
    return line;
  }).join('\n');
}

// ------------------------------------------------------- reports (not fixes)

const hex = (cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

function reportNonAscii(text, review) {
  text.split('\n').forEach((line, i) => {
    const seen = new Map();
    for (const ch of line) {
      const cp = ch.codePointAt(0);
      if (cp <= 0x7e || seen.has(cp)) continue;
      let label = 'non-ASCII character, use plain ASCII';
      if (DASH_ONE.test(ch)) label = 'dash, rephrase the sentence so it needs none (do not swap in a hyphen)';
      else if (CURLY_ONE.test(ch)) label = 'curly quote outside a comment or string, use a plain quote';
      seen.set(cp, label);
    }
    if (seen.size === 0) return;
    review.push({
      line: i + 1,
      message: [...seen].map(([cp, label]) => `${hex(cp)} ${label}`).join('; '),
      sample: line.trim().slice(0, 60).replace(/[^\x00-\x7e]/g, '?'),
    });
  });
}

// -------------------------------------------------------------------- main API

export function sanitizeText(text, filePath) {
  const profile = profileFor(filePath);
  const { changes, bump } = makeCounter();
  const review = [];
  if (!profile || text.includes('\u0000') || hasIgnoreMarker(text)) {
    return { text, changes, review, skipped: true };
  }

  let out = universalRules(text, bump);

  if (profile === 'js' || profile === 'json' || profile === 'css') out = processScannedFile(out, profile, bump, review);
  else if (profile === 'hash') out = processHash(out, bump);

  out = countingReplace(out, /[ \t]+(?=\r?$)/gm, '', 'trailing', bump);

  const nfc = out.normalize('NFC');
  if (nfc !== out) { bump('normalization'); out = nfc; }

  reportNonAscii(out, review);
  return { text: out, changes, review, skipped: false };
}

export function sanitizeFile(filePath, { check = false, root = process.cwd() } = {}) {
  if (isIgnored(filePath, root)) return { file: filePath, changed: false, changes: makeCounter().changes, review: [], skipped: true };
  const original = fs.readFileSync(filePath, 'utf8');
  const result = sanitizeText(original, filePath);
  const changed = !result.skipped && result.text !== original;
  if (changed && !check) fs.writeFileSync(filePath, result.text);
  return { file: filePath, changed, changes: result.changes, review: result.review, skipped: result.skipped };
}

// ------------------------------------------------------------------------ CLI

function walk(target, out) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    if (SKIP_DIRS.has(path.basename(target))) return;
    for (const name of fs.readdirSync(target)) walk(path.join(target, name), out);
  } else if (profileFor(target)) {
    out.push(target);
  }
}

function summarize(r) {
  return Object.entries(r.changes).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(', ');
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function runHook() {
  let payload;
  try { payload = JSON.parse(readStdin() || '{}'); } catch { return 0; }
  const cwd = payload.cwd || process.cwd();
  const target = (payload.tool_input || {}).file_path;
  if (!target) return 0;
  const abs = path.resolve(cwd, target);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return 0; // outside the project
  if (!fs.existsSync(abs) || !profileFor(abs)) return 0;
  const r = sanitizeFile(abs, { root: cwd });
  const notes = [];
  if (r.changed) notes.push(`sanitize: cleaned ${rel} (${summarize(r)}). Write plain ASCII next time.`);
  for (const item of r.review) {
    notes.push(`sanitize: fix by hand ${rel}${item.line ? `:${item.line}` : ''}: ${item.message}`);
  }
  if (notes.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notes.join('\n') } }));
  }
  return 0;
}

function main(argv) {
  if (argv.includes('--hook')) return runHook();
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const targets = argv.filter((a) => !a.startsWith('--'));
  const check = flags.has('--check');

  const files = [];
  if (flags.has('--staged')) {
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], { encoding: 'utf8' })
      .split('\n').filter(Boolean);
    for (const f of staged) if (fs.existsSync(f) && profileFor(f)) files.push(f);
  }
  for (const t of targets) walk(t, files);
  if (files.length === 0) {
    if (!flags.has('--quiet')) console.log('sanitize: no supported files');
    return 0;
  }

  const results = files.map((f) => sanitizeFile(f, { check }));
  const dirty = results.filter((r) => r.changed || r.review.length);
  if (flags.has('--json')) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    for (const r of dirty) {
      if (r.changed) console.log(`${check ? 'would fix' : 'fixed'} ${r.file}: ${summarize(r)}`);
      for (const item of r.review) {
        console.log(`fix by hand ${r.file}${item.line ? `:${item.line}` : ''}: ${item.message}${item.sample ? ` [${item.sample}]` : ''}`);
      }
    }
    if (!flags.has('--quiet')) console.log(`sanitize: ${files.length} file(s) checked, ${dirty.length} with findings`);
  }
  if (check) return dirty.length ? 1 : 0;
  return results.some((r) => r.review.length) ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  process.exit(main(process.argv.slice(2)));
}
