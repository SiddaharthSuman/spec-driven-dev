import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileKind, isNoise, unitKey, isSensitive } from '../lib/classify.mjs';

test('fileKind: recognizes generated, test, doc, style, config, and falls back to source', () => {
  assert.equal(fileKind('dist/bundle.js'), 'generated');
  assert.equal(fileKind('src/features/x/__snapshots__/a.snap'), 'generated');
  assert.equal(fileKind('src/features/x/filters.test.ts'), 'test');
  assert.equal(fileKind('e2e/login.spec.ts'), 'test');
  assert.equal(fileKind('docs/012-invoice-filtering.md'), 'doc');
  assert.equal(fileKind('src/App.css'), 'style');
  assert.equal(fileKind('.eslintrc.json'), 'config');
  assert.equal(fileKind('package.json'), 'config');
  assert.equal(fileKind('src/features/invoices/filters.ts'), 'source');
});

test('isNoise: lockfiles are noise regardless of status', () => {
  assert.equal(isNoise({ status: 'M', path: 'pnpm-lock.yaml' }), true);
  assert.equal(isNoise({ status: 'M', path: 'package-lock.json' }), true);
  assert.equal(isNoise({ status: 'M', path: 'yarn.lock' }), true);
});

test('isNoise: generated paths are noise', () => {
  assert.equal(isNoise({ status: 'M', path: 'dist/bundle.js' }), true);
});

test('isNoise: a pure rename (similarity 100) is noise, a rename with edits is not', () => {
  assert.equal(isNoise({ status: 'R', path: 'src/b.ts', similarity: 100 }), true);
  assert.equal(isNoise({ status: 'R', path: 'src/b.ts', similarity: 87 }), false);
});

test('isNoise: whitespace-only is caller-supplied, not inferred from status/path', () => {
  const entry = { status: 'M', path: 'src/features/invoices/filters.ts' };
  assert.equal(isNoise(entry), false);
  assert.equal(isNoise(entry, { whitespaceOnly: true }), true);
});

test('isNoise: an ordinary source edit is never noise', () => {
  assert.equal(isNoise({ status: 'M', path: 'src/features/invoices/filters.ts' }), false);
});

test('unitKey: groups by the top two path segments', () => {
  assert.equal(unitKey('src/features/invoices/filters.ts'), 'src/features');
  assert.equal(unitKey('src/services/invoices.api.ts'), 'src/services');
});

test('unitKey: falls back to the top segment for shallow paths', () => {
  assert.equal(unitKey('package.json'), 'package.json');
});

test('isSensitive: matches auth/security/permission/token/secret/credential (case-insensitive)', () => {
  assert.equal(isSensitive('src/lib/AuthProvider.tsx'), true);
  assert.equal(isSensitive('src/features/security/rbac.ts'), true);
  assert.equal(isSensitive('src/features/invoices/filters.ts'), false);
});
