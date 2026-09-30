import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, tierOf, effortOf, suggestBudget, tierCheck, calibrate, computeStats, readEvents, flagHighTokens, renderMarkdown } from './engineer-stats.mjs';

const M = 60000;
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'stats-'));

function run(dir, log, args) {
  return main([...args, '--dir', path.join(dir, 'state'), '--log', log]);
}

test('tierOf and effortOf map model names and effort words', () => {
  assert.equal(tierOf('claude-haiku-4-5'), 'fast');
  assert.equal(tierOf('sonnet'), 'mid');
  assert.equal(tierOf('Opus 5.5'), 'strong');
  assert.equal(tierOf('fable'), 'strong');
  assert.equal(tierOf('gpt'), null);
  assert.equal(effortOf('LOW'), 'low');
  assert.equal(effortOf('medium'), 'medium');
  assert.equal(effortOf('xhigh'), 'high');
});

test('suggestBudget: default table is size base times tier and effort multiplier', () => {
  assert.deepEqual(suggestBudget({ size: 'S', model: 'haiku', effort: 'low' }), { minutes: 6, source: 'default', n: 0 });
  assert.equal(suggestBudget({ size: 'M', model: 'sonnet', effort: 'high' }).minutes, 30);
  assert.equal(suggestBudget({ size: 'XS', model: 'opus', effort: 'medium' }).minutes, 10.5);
  assert.throws(() => suggestBudget({ size: 'L', model: 'haiku', effort: 'low' }), /unknown size/);
});

test('tierCheck: a model stronger than the orchestrator needs consent, equal or weaker does not', () => {
  assert.equal(tierCheck('sonnet', 'opus').ok, false);
  assert.match(tierCheck('sonnet', 'opus').message, /needs user consent/);
  assert.equal(tierCheck('sonnet', 'sonnet').ok, true);
  assert.equal(tierCheck('sonnet', 'haiku').ok, true);
  assert.equal(tierCheck('opus', 'fable').ok, true);
});

test('tier-check command exits with code 3 when consent is needed', () => {
  const dir = tmp();
  assert.throws(() => run(dir, dir, ['tier-check', 'orchestrator=sonnet', 'requested=opus']), (e) => e.exitCode === 3);
  assert.match(run(dir, dir, ['tier-check', 'orchestrator=sonnet', 'requested=haiku']), /^ok/);
});

function fullRun(dir, log, name, { workerMin = { 'W1-a': 2, 'W2-a': 9, 'W2-b': 10 } } = {}) {
  const r = ['--run', name];
  const call = (...a) => run(dir, log, [...a, ...r]);
  call('start', 'spec=docs/specs/x/001-dash.md', 'orchestrator=sonnet:high', 'ts=0');
  call('event', 'subspec-plan', 'id=W1-a', 'wave=1', 'size=XS', 'model=haiku', 'effort=low', 'files=1', 'criteria=2', 'ts=0');
  call('event', 'subspec-plan', 'id=W2-a', 'wave=2', 'size=S', 'model=haiku', 'effort=low', 'files=3', 'criteria=4', 'ts=0');
  call('event', 'subspec-plan', 'id=W2-b', 'wave=2', 'size=M', 'model=haiku', 'effort=medium', 'files=5', 'criteria=6', 'ts=0');
  const budgets = JSON.parse(call('budgets', 'orchestrator=sonnet:high', 'baseline_gate_min=1', 'full_gate_min=4'));
  call('event', 'planning-start', `ts=${0}`);
  call('event', 'planning-end', `ts=${20 * M}`);
  let t = 20 * M;
  call('event', 'wave-start', 'wave=1', `ts=${t}`);
  call('event', 'worker-start', 'id=W1-a', `ts=${t}`);
  t += workerMin['W1-a'] * M;
  call('event', 'worker-end', 'id=W1-a', 'status=done', 'tokens=1000', `ts=${t}`);
  call('event', 'verify-start', 'id=W1-a', `ts=${t}`);
  call('event', 'verify-end', 'id=W1-a', 'verdict=PASS', `ts=${t + 2 * M}`);
  t += 2 * M;
  call('event', 'wave-end', 'wave=1', 'cause=none', `ts=${t}`);
  call('event', 'wave-start', 'wave=2', `ts=${t}`);
  call('event', 'worker-start', 'id=W2-a', `ts=${t}`);
  call('event', 'worker-start', 'id=W2-b', `ts=${t}`);
  call('event', 'worker-end', 'id=W2-a', 'status=done', 'tokens=2000', `ts=${t + workerMin['W2-a'] * M}`);
  call('event', 'blocked', 'id=W2-b', 'missing=i18n key audit.title');
  call('event', 'worker-end', 'id=W2-b', 'status=done', 'tokens=3000', `ts=${t + workerMin['W2-b'] * M}`);
  t += 12 * M;
  call('event', 'wave-end', 'wave=2', 'cause=dependency-gap', `ts=${t}`);
  call('event', 'unplanned', 'file=src/extra.ts');
  call('event', 'consent', 'role=worker', 'from=haiku', 'to=sonnet', 'decision=granted');
  call('event', 'gate-start', 'name=final', `ts=${t}`);
  call('event', 'gate-end', 'name=final', `ts=${t + 3 * M}`);
  call('finish', 'verdict=PASS', `ts=${t + 40 * M}`);
  return budgets;
}

test('budgets: worker, verifier, wave, planning and whole-run numbers follow the tables', () => {
  const dir = tmp();
  const log = path.join(dir, 'log');
  const b = fullRun(dir, log, 'r1');
  assert.deepEqual(b.workers, { 'W1-a': 3, 'W2-a': 6, 'W2-b': 12.5 });
  assert.equal(b.verifiers['W1-a'], 6);
  assert.equal(b.waves['1'], 12);
  assert.equal(b.waves['2'], 21.5);
  assert.equal(b.planning_min, 30);
  assert.equal(b.final_verifier_min, 12);
  assert.equal(b.run_min, 82.5);
});

test('finish: writes measured stats, a readable table, and a calibration file', () => {
  const dir = tmp();
  const log = path.join(dir, 'log');
  fullRun(dir, log, 'r1');
  const files = fs.readdirSync(log);
  const jsonName = files.find((f) => f.endsWith('-r1.run-stats.json'));
  const mdName = files.find((f) => f.endsWith('-r1.run-stats.md'));
  assert.ok(jsonName && mdName);
  assert.ok(files.includes('budget-calibration.json'));

  const s = JSON.parse(fs.readFileSync(path.join(log, jsonName), 'utf8'));
  const w1 = s.workers.find((w) => w.id === 'W1-a');
  assert.equal(w1.actual_min, 2);
  assert.equal(w1.budget_min, 3);
  assert.equal(w1.error_pct, -33);
  assert.equal(w1.verdict, 'PASS');
  assert.equal(w1.verify_min, 2);
  assert.equal(w1.tokens, 1000);
  const w2b = s.workers.find((w) => w.id === 'W2-b');
  assert.equal(w2b.blocked, 1);
  assert.equal(s.waves.find((w) => w.wave === '2').cause, 'dependency-gap');
  assert.equal(s.planning.actual_min, 20);
  assert.equal(s.planning.budget_min, 30);
  assert.equal(s.run_total.actual_min, 76);
  assert.equal(s.run_total.tokens, 6000);
  assert.deepEqual(s.unplanned_files, ['src/extra.ts']);
  assert.equal(s.consent[0].decision, 'granted');
  assert.deepEqual(s.accuracy.over_budget, ['W2-a']);
  assert.deepEqual(s.accuracy.under_half_budget, []);
  assert.equal(s.final_verdict, 'PASS');

  const md = fs.readFileSync(path.join(log, mdName), 'utf8');
  assert.match(md, /^# Run statistics: r1/);
  assert.match(md, /\| W1-a \| 1 \| XS \| haiku \| low \|/);
  assert.match(md, /## BLOCKED reports/);
  assert.doesNotMatch(md, /[^\x00-\x7e]/);
});

test('re-dispatch: a second worker-start counts as an attempt and adds to actual time', () => {
  const dir = tmp();
  const log = path.join(dir, 'log');
  const f = path.join(dir, 'state', 'r2', 'events.jsonl');
  const call = (...a) => run(dir, log, [...a, '--run', 'r2']);
  call('start', 'spec=s', 'orchestrator=sonnet:high', 'ts=0');
  call('event', 'subspec-plan', 'id=A', 'wave=1', 'size=S', 'model=haiku', 'effort=low', 'ts=0');
  call('event', 'worker-start', 'id=A', 'ts=0');
  call('event', 'worker-end', 'id=A', 'status=blocked', `ts=${2 * M}`);
  call('event', 'worker-start', 'id=A', `ts=${5 * M}`);
  call('event', 'worker-end', 'id=A', 'status=done', `ts=${9 * M}`);
  const w = computeStats(readEvents(f)).workers[0];
  assert.equal(w.attempts, 2);
  assert.equal(w.actual_min, 6);
  assert.equal(w.status, 'done');
});

test('under-half budget is flagged for review', () => {
  const dir = tmp();
  const log = path.join(dir, 'log');
  fullRun(dir, log, 'r3', { workerMin: { 'W1-a': 1, 'W2-a': 2, 'W2-b': 10 } });
  const s = JSON.parse(fs.readFileSync(path.join(log, fs.readdirSync(log).find((n) => n.endsWith('-r3.run-stats.json'))), 'utf8'));
  assert.deepEqual(s.accuracy.under_half_budget, ['W1-a', 'W2-a']);
});

test('calibration: medians per size, tier and effort, used by suggest once there are 3 samples', () => {
  const dir = tmp();
  const log = path.join(dir, 'log');
  for (const name of ['a', 'b', 'c']) fullRun(dir, log, name, { workerMin: { 'W1-a': 2, 'W2-a': 4, 'W2-b': 9 } });
  const c = calibrate(log);
  assert.equal(c.groups['XS|fast|low'].n, 3);
  assert.equal(c.groups['XS|fast|low'].medianMin, 2);
  assert.equal(c.groups['S|fast|low'].medianMin, 4);
  const s = JSON.parse(main(['suggest', 'size=S', 'model=haiku', 'effort=low', '--log', log]));
  assert.equal(s.source, 'calibration');
  assert.equal(s.minutes, 5);
  const fresh = JSON.parse(main(['suggest', 'size=M', 'model=sonnet', 'effort=low', '--log', log]));
  assert.equal(fresh.source, 'default');
});

test('budgets: missing subspec plans or an unknown model raise a clear error', () => {
  const dir = tmp();
  const log = path.join(dir, 'log');
  run(dir, log, ['start', '--run', 'e', 'orchestrator=sonnet:high']);
  assert.throws(() => run(dir, log, ['budgets', '--run', 'e', 'orchestrator=sonnet:high', 'baseline_gate_min=1', 'full_gate_min=2']), /no subspec-plan/);
  run(dir, log, ['event', 'subspec-plan', '--run', 'e', 'id=A', 'wave=1', 'size=S', 'model=llama', 'effort=low']);
  assert.throws(() => run(dir, log, ['budgets', '--run', 'e', 'orchestrator=sonnet:high', 'baseline_gate_min=1', 'full_gate_min=2']), /unknown model/);
});

test('computeStats: tokens are split by role, and run totals still add up', () => {
  const s = computeStats([
    { type: 'subspec-plan', id: 'W1', wave: 1, size: 'S', model: 'haiku', effort: 'low' },
    { type: 'tokens', scope: 'orchestrator', in: 1000, out: 500 },
    { type: 'worker-end', id: 'W1', status: 'done', tokens: 4000 },
    { type: 'verify-end', id: 'W1', verdict: 'PASS', tokens: 1500 },
    { type: 'tokens', scope: 'other-thing', in: 10, out: 0 },
  ]);
  assert.deepEqual(s.run_total.tokens_by_role, { orchestrator: 1500, workers: 4000, verifiers: 1500, other: 10 });
  assert.equal(s.run_total.tokens, 7010);
  assert.equal(s.workers[0].tokens, 5500);
});

test('computeStats: no token data means no role breakdown', () => {
  assert.equal(computeStats([]).run_total.tokens_by_role, null);
});

test('calibrate records median tokens per group and flagHighTokens needs 3 samples', () => {
  const log = tmp();
  const w = (tokens) => ({ status: 'done', actual_min: 5, size: 'S', model: 'haiku', effort: 'low', ratio: 1, tokens });
  const write = (name, tokens) =>
    fs.writeFileSync(path.join(log, `${name}.run-stats.json`), JSON.stringify({ workers: [w(tokens)] }));
  write('a', 1000);
  write('b', 2000);
  let c = calibrate(log);
  assert.equal(c.groups['S|fast|low'].nTokens, 2);
  const probe = () => ({ workers: [{ id: 'W9', size: 'S', model: 'haiku', effort: 'low', tokens: 9000 }], accuracy: {} });
  assert.deepEqual(flagHighTokens(probe(), c).accuracy.high_token_workers, []);
  write('c', 3000);
  c = calibrate(log);
  assert.equal(c.groups['S|fast|low'].medianTokens, 2000);
  assert.deepEqual(flagHighTokens(probe(), c).accuracy.high_token_workers, ['W9']);
  const ok = { workers: [{ id: 'W8', size: 'S', model: 'haiku', effort: 'low', tokens: 3900 }], accuracy: {} };
  assert.deepEqual(flagHighTokens(ok, c).accuracy.high_token_workers, []);
});

test('renderMarkdown shows a token share table when tokens were recorded', () => {
  const s = computeStats([
    { type: 'worker-end', id: 'W1', tokens: 3000 },
    { type: 'verify-end', id: 'W1', tokens: 1000 },
  ]);
  const md = renderMarkdown(flagHighTokens(s, null));
  assert.match(md, /## Tokens by role/);
  assert.match(md, /\| workers \| 3000 \| 75 \|/);
  assert.match(md, /Tokens over twice the median of past runs \| none/);
});
