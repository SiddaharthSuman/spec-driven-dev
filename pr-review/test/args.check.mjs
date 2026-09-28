import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, parsePrList, parseList } from '../lib/args.mjs';

test('parseArgs: kebab-case flags become camelCase keys with values', () => {
  const args = parseArgs(['--repo', '/tmp/x', '--base-caption', 'before']);
  assert.equal(args.repo, '/tmp/x');
  assert.equal(args.baseCaption, 'before');
});

test('parseArgs: a flag with no value (end of argv, or followed by another flag) is boolean true', () => {
  assert.equal(parseArgs(['--force']).force, true);
  assert.equal(parseArgs(['--force', '--repo', '/x']).force, true);
});

test('parseArgs: tokens that do not start with -- are ignored', () => {
  const args = parseArgs(['prepare', '--pr', '812']);
  assert.equal(args.prepare, undefined);
  assert.equal(args.pr, '812');
});

test('parsePrList: splits on whitespace or commas and drops non-numeric junk', () => {
  assert.deepEqual(parsePrList('670 671'), [670, 671]);
  assert.deepEqual(parsePrList('670,671,672'), [670, 671, 672]);
  assert.deepEqual(parsePrList('670, oops ,671'), [670, 671]);
  assert.deepEqual(parsePrList(''), []);
  assert.deepEqual(parsePrList(undefined), []);
});

test('parseList: splits on commas and trims whitespace', () => {
  assert.deepEqual(parseList('a.ts, b.ts ,c.ts'), ['a.ts', 'b.ts', 'c.ts']);
  assert.deepEqual(parseList(''), []);
});
