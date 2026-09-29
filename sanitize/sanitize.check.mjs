import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeText, sanitizeFile, isIgnored } from './sanitize.mjs';

const run = (text, file = 'x.ts') => sanitizeText(text, file);
const out = (text, file) => run(text, file).text;

test('hidden: zero-width, soft hyphen, BOM, bidi, joiners, variation selectors, and tag characters are removed', () => {
  const dirty = '\uFEFFa\u200Bb\u00ADc\u202Ed\u2066e\u{E0041}f\u200Dg\uFE0Fh';
  assert.equal(out(dirty, 'a.ts'), 'abcdefgh');
  assert.equal(run(dirty, 'a.ts').changes.hidden, 8);
});

test('spaces: non-breaking and other unusual spaces become plain spaces', () => {
  assert.equal(out('a\u00A0b\u2009c\u202Fd\u3000e', 'a.ts'), 'a b c d e');
});

test('dashes: em and en dashes are reported, never rewritten', () => {
  const src = '// one \u2014 two\nconst r = "3\u20135";\n';
  const r = run(src);
  assert.equal(r.text, src);
  assert.equal(r.review.length, 2);
  assert.match(r.review[0].message, /U\+2014 dash, rephrase/);
  assert.match(r.review[1].message, /U\+2013 dash, rephrase/);
  assert.equal(r.review[0].line, 1);
});

test('dashes: minus sign and unusual hyphens are fixed mechanically as lookalikes', () => {
  assert.equal(out('x \u2212 y \u2010 z', 'a.ts'), 'x - y - z');
});

test('report samples and messages stay plain ASCII', () => {
  const r = run('// one \u2014 two\n');
  assert.doesNotMatch(JSON.stringify(r.review), /[^\x00-\x7e]/);
});

test('quotes: curly quotes in comments become straight', () => {
  assert.equal(out('// \u201Chello\u201D it\u2019s\n', 'a.ts'), '// "hello" it\'s\n');
});

test('quotes: escaped correctly inside string literals so code still parses', () => {
  const src = 'const a = "say \u201Chi\u201D it\u2019s";\nconst b = \'it\u2019s \u201Cok\u201D\';\n';
  const fixed = out(src, 'x.ts');
  assert.equal(fixed, 'const a = "say \\"hi\\" it\'s";\nconst b = \'it\\\'s "ok"\';\n');
  assert.doesNotThrow(() => new Function(fixed.replace(/^const /gm, 'var ')));
});

test('quotes: JSON string values stay valid JSON', () => {
  const src = '{"msg": "Click \u201CSave\u201D to continue\u2026"}\n';
  const fixed = out(src, 'x.json');
  assert.equal(JSON.parse(fixed).msg, 'Click "Save" to continue...');
});

test('quotes: template literals need no escaping; curly quotes in code positions are reported', () => {
  assert.equal(out('const a = `\u201Cx\u201D`;', 'x.ts'), 'const a = `"x"`;');
  const r = run('<p>\u201Cx\u201D</p>\n', 'x.tsx');
  assert.equal(r.review.length, 1);
  assert.match(r.review[0].message, /curly quote/);
  assert.match(r.text, /\u201C/);
});

test('ellipsis: single character becomes three dots', () => {
  assert.equal(out('// wait\u2026', 'a.ts'), '// wait...');
});

test('trailing: trailing spaces and tabs removed, CRLF preserved', () => {
  assert.equal(out('a  \nb\t\r\nc', 'a.ts'), 'a\nb\r\nc');
});

test('asterisks and headings: stripped from code comments', () => {
  assert.equal(out('// **Important** note about *this*\n', 'x.ts'), '// Important note about this\n');
  assert.equal(out('// ## Setup\n', 'x.ts'), '// Setup\n');
  assert.equal(out('// #region foo\n', 'x.ts'), '// #region foo\n');
});

test('asterisks: JSDoc line prefixes and closers are kept', () => {
  const src = '/**\n * **Bold** text\n * more\n */\nfoo();\n';
  assert.equal(out(src, 'x.ts'), '/**\n * Bold text\n * more\n */\nfoo();\n');
});

test('asterisks: globs, regexes, and multiplication are never touched', () => {
  const src = [
    'const g = "src/**/*.ts";',
    'const h = "**/foo/**/bar";',
    'const r = /a*b*c/;',
    'const m = 2 * 3 * 4;',
    '// ignore **/node_modules/** and *.tsx files',
    '',
  ].join('\n');
  assert.equal(out(src, 'x.ts'), src);
});

test('asterisks: prose-like JSON values are stripped, path-like ones are not', () => {
  const fixed = JSON.parse(out('{"a": "**Note** this", "b": "src/**/*.ts"}', 'x.json'));
  assert.equal(fixed.a, 'Note this');
  assert.equal(fixed.b, 'src/**/*.ts');
});

test('asterisks: bold markers in a code string literal are reported, not changed', () => {
  const r = run('const s = "**Note** this is bold";\n');
  assert.equal(r.text, 'const s = "**Note** this is bold";\n');
  assert.equal(r.review.length, 1);
});

test('markdown and text files are exempt from every rule', () => {
  const md = '# Title \u2014 with dash\u2026  \n\n**Status:** \u201Cok\u201D\u00A0here\n';
  const r = run(md, 'a.md');
  assert.equal(r.skipped, true);
  assert.equal(r.text, md);
  assert.equal(run(md, 'a.txt').skipped, true);
});

test('lookalikes: Cyrillic and Greek letters are replaced everywhere, even in a standalone word', () => {
  assert.equal(out('// p\u0430ssword', 'a.ts'), '// password');
  assert.equal(out('// \u0441\u043E', 'a.ts'), '// co');
});

test('lookalikes: fullwidth, ligatures, and math alphabet letters become ASCII', () => {
  assert.equal(out('// \uFF21\uFF22\uFF11', 'a.ts'), '// AB1');
  assert.equal(out('// o\uFB03ce', 'a.ts'), '// office');
  assert.equal(out('// \u{1D400}\u{1D41A}', 'a.ts'), '// Aa');
});

test('non-ASCII: anything else that survives is reported with its code point', () => {
  const r = run('const label = "caf\u00E9 \u2192 \u2713";\n');
  assert.equal(r.review.length, 1);
  assert.match(r.review[0].message, /U\+00E9/);
  assert.match(r.review[0].message, /U\+2192/);
  assert.match(r.review[0].message, /U\+2713/);
});

test('normalization: decomposed accents are composed, then reported as non-ASCII', () => {
  const r = run('// e\u0301\n');
  assert.equal(r.changes.normalization, 1);
  assert.equal(r.review.length, 1);
});

test('hash files: comment text is cleaned, values are not', () => {
  assert.equal(out('key: "a*b*c" # **note** here\n', 'x.yml'), 'key: "a*b*c" # note here\n');
});

test('lock files and unsupported types are skipped untouched', () => {
  assert.equal(run('a\u2014b', 'x.png').skipped, true);
  assert.equal(run('a\u2014b', 'package-lock.json').skipped, true);
});

test('ignore marker in the first 5 lines skips the file, later lines do not count', () => {
  const marker = ['sanitize', 'ignore', 'file'].join('-');
  assert.equal(run(`// ${marker}\nconst a = "\u2014";\n`).skipped, true);
  assert.equal(run(`\n\n\n\n\n\n// ${marker}\nconst a = "\u2014";\n`).skipped, false);
});

test('.sanitizeignore skips listed paths and globs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sanitize-'));
  fs.writeFileSync(path.join(root, '.sanitizeignore'), '# fixtures\ntests/fixtures/**\nlegacy.ts\n');
  fs.mkdirSync(path.join(root, 'tests/fixtures'), { recursive: true });
  const dirty = 'const a = "x\u00A0y";\n';
  fs.writeFileSync(path.join(root, 'tests/fixtures/u.ts'), dirty);
  fs.writeFileSync(path.join(root, 'legacy.ts'), dirty);
  fs.writeFileSync(path.join(root, 'app.ts'), dirty);
  assert.equal(isIgnored('tests/fixtures/u.ts', root), true);
  assert.equal(isIgnored('legacy.ts', root), true);
  assert.equal(isIgnored('app.ts', root), false);
  assert.equal(sanitizeFile(path.join(root, 'tests/fixtures/u.ts'), { root }).skipped, true);
  assert.equal(fs.readFileSync(path.join(root, 'tests/fixtures/u.ts'), 'utf8'), dirty);
  assert.equal(sanitizeFile(path.join(root, 'app.ts'), { root }).changed, true);
  assert.equal(fs.readFileSync(path.join(root, 'app.ts'), 'utf8'), 'const a = "x y";\n');
});

test('idempotent: a second pass changes nothing', () => {
  const dirty = 'const a = "\u201Cx\u201D"; // **hi** there\u2026  \n';
  const once = out(dirty, 'x.ts');
  const twice = run(once, 'x.ts');
  assert.equal(twice.text, once);
  assert.equal(Object.values(twice.changes).reduce((a, b) => a + b, 0), 0);
  assert.equal(twice.review.length, 0);
});
