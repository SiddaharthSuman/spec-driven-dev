#!/usr/bin/env node
// Run statistics for /engineer. Zero dependencies, ASCII only.
//
// The orchestrator calls this at each state change so every number in the run
// report is measured (timestamps and reported usage), never remembered.
//
// Commands (state lives in .engineer/<run>/events.jsonl while the run is live):
//   start   --run <slug> spec=<path> orchestrator=<model:effort> [k=v ...]
//   event   --run <slug> <type> [k=v ...]        append one event
//   budgets --run <slug> orchestrator=<model:effort> baseline_gate_min=<n>
//           full_gate_min=<n> [verifier=<model:effort>] [final_verifier=<model:effort>]
//           compute and record every budget from the registered subspecs
//   suggest size=<XS|S|M> model=<name> effort=<low|medium|high>   one budget
//   tier-check orchestrator=<model> requested=<model>            consent rule
//   finish  --run <slug> verdict=<PASS|FAIL|ESCALATED> [--print]
//           write <logdir>/<date>-<run>.run-stats.json and .md, refresh calibration
//   calibrate                                                     refresh calibration only
//
// Options: --dir <state dir, default .engineer>  --log <log dir, default docs/verification-log>
//
// Event types the orchestrator records (all optional except where budgets or
// reports need them):
//   subspec-plan   id wave size model effort files criteria [verifier] [budget_min]
//   planning-start / planning-end
//   wave-start / wave-end        wave [cause]
//   worker-start / worker-end    id [status=done|blocked|budget-report|failed] [tokens] [duration_ms]
//   verify-start / verify-end    id [verdict=PASS|FAIL] [tokens] [duration_ms]
//   gate-start / gate-end        name (baseline, full-baseline, wave-1, final, ...)
//   blocked                      id missing=<what was missing>
//   consent                      role from to decision=granted|denied
//   unplanned                    file
//   tokens                       scope id in out

import fs from 'node:fs';
import path from 'node:path';

// ------------------------------------------------------------ budget tables

export const SIZE_BASE_MIN = { XS: 3, S: 6, M: 10 };
export const TIER_MULT = {
  fast: { low: 1.0, medium: 1.25, high: 1.5 },
  mid: { low: 1.5, medium: 2.0, high: 3.0 },
  strong: { low: 2.5, medium: 3.5, high: 5.0 },
};
const TIER_RANK = { fast: 1, mid: 2, strong: 3 };
const VERIFIER_BASE_MIN = 3;
const PLANNING_BASE_MIN = 10;
const PLANNING_EXTRA_MIN = 2;
const MERGE_MIN = 2;
const ARCHIVE_MIN = 3;
const CALIBRATION_MIN_SAMPLES = 3;
const CALIBRATION_MARGIN = 1.25;

export function tierOf(model) {
  const m = String(model || '').toLowerCase();
  if (m.includes('haiku')) return 'fast';
  if (m.includes('sonnet')) return 'mid';
  if (m.includes('opus') || m.includes('fable') || m.includes('mythos')) return 'strong';
  return null;
}

export function effortOf(effort) {
  const e = String(effort || '').toLowerCase();
  if (e.startsWith('low') || e === 'min') return 'low';
  if (e.startsWith('med') || e === '') return 'medium';
  return 'high';
}

function splitRole(role) {
  const [model, effort] = String(role || '').split(':');
  return { model, effort: effortOf(effort) };
}

const round1 = (n) => Math.round(n * 10) / 10;
const ceilHalf = (n) => Math.ceil(n * 2) / 2;

export function multiplier(model, effort) {
  const tier = tierOf(model);
  if (!tier) throw new Error(`unknown model "${model}" (expected haiku, sonnet, opus, fable, or mythos in the name)`);
  return TIER_MULT[tier][effortOf(effort)];
}

// A budget for one worker: calibrated from history when there are enough
// samples for that exact size/tier/effort, otherwise the default table.
export function suggestBudget({ size, model, effort, calibration }) {
  if (!(size in SIZE_BASE_MIN)) throw new Error(`unknown size "${size}" (expected XS, S, or M)`);
  const tier = tierOf(model);
  const eff = effortOf(effort);
  const g = calibration?.groups?.[`${size}|${tier}|${eff}`];
  if (g && g.n >= CALIBRATION_MIN_SAMPLES) {
    return { minutes: ceilHalf(g.medianMin * CALIBRATION_MARGIN), source: 'calibration', n: g.n };
  }
  return { minutes: round1(SIZE_BASE_MIN[size] * multiplier(model, eff)), source: 'default', n: g ? g.n : 0 };
}

// Consent rule: a model stronger than the orchestrator's needs the human's yes.
export function tierCheck(orchestrator, requested) {
  const o = tierOf(orchestrator);
  const r = tierOf(requested);
  if (!o || !r) throw new Error(`unknown model in tier-check (orchestrator "${orchestrator}", requested "${requested}")`);
  return TIER_RANK[r] > TIER_RANK[o]
    ? { ok: false, message: `needs user consent: ${requested} (${r}) is stronger than the orchestrator ${orchestrator} (${o})` }
    : { ok: true, message: `ok: ${requested} (${r}) does not exceed the orchestrator ${orchestrator} (${o})` };
}

// ------------------------------------------------------------------ events

function coerce(v) {
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v;
}

export function readEvents(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

function appendEvent(file, event) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
}

// pair X-start / X-end events per key; sum intervals, count attempts
function pairDurations(events, startType, endType, keyField) {
  const open = new Map();
  const out = new Map();
  for (const e of events) {
    const key = keyField ? String(e[keyField]) : '_';
    if (e.type === startType) {
      open.set(key, e.ts);
      const cur = out.get(key) || { ms: 0, attempts: 0, last: null };
      cur.attempts += 1;
      out.set(key, cur);
    } else if (e.type === endType) {
      const cur = out.get(key) || { ms: 0, attempts: 0, last: null };
      const started = open.get(key);
      const ms = typeof e.duration_ms === 'number' ? e.duration_ms : started != null ? e.ts - started : 0;
      cur.ms += ms;
      cur.last = e;
      out.set(key, cur);
      open.delete(key);
    }
  }
  return out;
}

const minutes = (ms) => round1(ms / 60000);
const errPct = (actual, budget) => (budget > 0 ? Math.round(((actual - budget) / budget) * 100) : null);
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

// ------------------------------------------------------------------ budgets

export function computeBudgets(events, { orchestrator, baselineGateMin, fullGateMin, verifier = 'sonnet:medium', finalVerifier = 'sonnet:medium', calibration }) {
  const plans = events.filter((e) => e.type === 'subspec-plan');
  if (!plans.length) throw new Error('no subspec-plan events recorded yet');
  const orch = splitRole(orchestrator);
  const workers = {};
  const verifiers = {};
  for (const p of plans) {
    const s = suggestBudget({ size: p.size, model: p.model, effort: p.effort, calibration });
    const budget = typeof p.budget_min === 'number' ? p.budget_min : s.minutes;
    const v = splitRole(p.verifier || verifier);
    workers[p.id] = { minutes: budget, source: typeof p.budget_min === 'number' ? 'given' : s.source, wave: String(p.wave) };
    verifiers[p.id] = round1(VERIFIER_BASE_MIN * multiplier(v.model, v.effort));
  }
  const waves = {};
  for (const id of Object.keys(workers)) {
    const w = workers[id].wave;
    waves[w] = waves[w] || { workers: [], minutes: 0 };
    waves[w].workers.push(id);
  }
  for (const w of Object.keys(waves)) {
    const ids = waves[w].workers;
    waves[w].minutes = round1(
      Math.max(...ids.map((i) => workers[i].minutes)) + Math.max(...ids.map((i) => verifiers[i])) + baselineGateMin + MERGE_MIN,
    );
  }
  const planningMin = round1((PLANNING_BASE_MIN + PLANNING_EXTRA_MIN * Math.max(0, plans.length - 5)) * multiplier(orch.model, orch.effort));
  const fv = splitRole(finalVerifier);
  const finalVerifierMin = round1(VERIFIER_BASE_MIN * multiplier(fv.model, fv.effort) * 2);
  const runMin = round1(planningMin + Object.values(waves).reduce((a, w) => a + w.minutes, 0) + fullGateMin + finalVerifierMin + ARCHIVE_MIN);
  return {
    planning_min: planningMin,
    workers: Object.fromEntries(Object.entries(workers).map(([k, v]) => [k, v.minutes])),
    worker_sources: Object.fromEntries(Object.entries(workers).map(([k, v]) => [k, v.source])),
    verifiers,
    waves: Object.fromEntries(Object.entries(waves).map(([k, v]) => [k, v.minutes])),
    final_verifier_min: finalVerifierMin,
    full_gate_min: fullGateMin,
    baseline_gate_min: baselineGateMin,
    run_min: runMin,
  };
}

// -------------------------------------------------------------------- stats

export function computeStats(events) {
  const start = events.find((e) => e.type === 'start') || {};
  const finish = [...events].reverse().find((e) => e.type === 'finish') || {};
  const budgets = [...events].reverse().find((e) => e.type === 'budget-plan') || {};
  const plans = events.filter((e) => e.type === 'subspec-plan');

  const workerT = pairDurations(events, 'worker-start', 'worker-end', 'id');
  const verifyT = pairDurations(events, 'verify-start', 'verify-end', 'id');
  const waveT = pairDurations(events, 'wave-start', 'wave-end', 'wave');
  const planningT = pairDurations(events, 'planning-start', 'planning-end', null).get('_');

  const tokensBy = {};
  let tokensTotal = 0;
  for (const e of events) {
    const n = (typeof e.tokens === 'number' ? e.tokens : 0) + (typeof e.in === 'number' ? e.in : 0) + (typeof e.out === 'number' ? e.out : 0);
    if (!n) continue;
    tokensTotal += n;
    if (e.id) tokensBy[e.id] = (tokensBy[e.id] || 0) + n;
  }

  const blocked = events.filter((e) => e.type === 'blocked').map((e) => ({ id: e.id, missing: e.missing }));
  const workers = plans.map((p) => {
    const t = workerT.get(String(p.id));
    const v = verifyT.get(String(p.id));
    const budget = budgets.workers?.[p.id] ?? (typeof p.budget_min === 'number' ? p.budget_min : null);
    const actual = t ? minutes(t.ms) : null;
    return {
      id: p.id, wave: String(p.wave), size: p.size, model: p.model, effort: effortOf(p.effort),
      files: p.files ?? null, criteria: p.criteria ?? null,
      budget_min: budget, actual_min: actual,
      ratio: budget && actual != null ? round1(actual / budget) : null,
      error_pct: budget && actual != null ? errPct(actual, budget) : null,
      attempts: t ? t.attempts : 0,
      status: t?.last?.status ?? (t ? 'running' : 'not-run'),
      blocked: blocked.filter((b) => String(b.id) === String(p.id)).length,
      verify_min: v ? minutes(v.ms) : null,
      verdict: v?.last?.verdict ?? null,
      tokens: tokensBy[p.id] ?? null,
    };
  });

  const waveIds = [...new Set([...Object.keys(budgets.waves || {}), ...workers.map((w) => w.wave)])].sort((a, b) => Number(a) - Number(b));
  const waves = waveIds.map((w) => {
    const t = waveT.get(String(w));
    const budget = budgets.waves?.[w] ?? null;
    const actual = t ? minutes(t.ms) : null;
    return {
      wave: w, workers: workers.filter((x) => x.wave === w).map((x) => x.id),
      budget_min: budget, actual_min: actual,
      error_pct: budget && actual != null ? errPct(actual, budget) : null,
      cause: t?.last?.cause ?? null,
    };
  });

  const gateT = new Map();
  const openG = new Map();
  for (const e of events) {
    if (e.type === 'gate-start') openG.set(e.name, e.ts);
    if (e.type === 'gate-end') {
      const ms = typeof e.duration_ms === 'number' ? e.duration_ms : e.ts - (openG.get(e.name) ?? e.ts);
      gateT.set(e.name, [...(gateT.get(e.name) || []), minutes(ms)]);
    }
  }

  const runActual = start.ts != null && finish.ts != null ? minutes(finish.ts - start.ts) : null;
  const overWorkers = workers.filter((w) => w.ratio != null && w.ratio > 1);
  const underWorkers = workers.filter((w) => w.ratio != null && w.ratio < 0.5);
  const absErrs = workers.filter((w) => w.error_pct != null).map((w) => Math.abs(w.error_pct));

  return {
    run: start.run ?? null,
    spec: start.spec ?? null,
    orchestrator: start.orchestrator ?? null,
    verdict_go_no_go: start.verdict ?? null,
    started: start.ts != null ? new Date(start.ts).toISOString() : null,
    finished: finish.ts != null ? new Date(finish.ts).toISOString() : null,
    final_verdict: finish.verdict ?? null,
    planning: { budget_min: budgets.planning_min ?? null, actual_min: planningT ? minutes(planningT.ms) : null },
    run_total: {
      budget_min: budgets.run_min ?? null, actual_min: runActual,
      error_pct: budgets.run_min && runActual != null ? errPct(runActual, budgets.run_min) : null,
      tokens: tokensTotal || null,
    },
    waves, workers,
    gates: Object.fromEntries([...gateT].map(([k, v]) => [k, v])),
    blocked,
    consent: events.filter((e) => e.type === 'consent').map((e) => ({ role: e.role, from: e.from, to: e.to, decision: e.decision })),
    unplanned_files: events.filter((e) => e.type === 'unplanned').map((e) => e.file),
    accuracy: {
      workers_measured: absErrs.length,
      mean_abs_error_pct: absErrs.length ? Math.round(absErrs.reduce((a, b) => a + b, 0) / absErrs.length) : null,
      over_budget: overWorkers.map((w) => w.id),
      under_half_budget: underWorkers.map((w) => w.id),
    },
  };
}

// ----------------------------------------------------------------- markdown

const cell = (v) => (v == null ? '-' : String(v));
const table = (head, rows) => [
  `| ${head.join(' | ')} |`,
  `| ${head.map(() => '---').join(' | ')} |`,
  ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
].join('\n');

export function renderMarkdown(s) {
  const out = [];
  out.push(`# Run statistics: ${cell(s.run)}`, '');
  out.push(table(['Field', 'Value'], [
    ['Spec', s.spec], ['Orchestrator', s.orchestrator], ['Started', s.started], ['Finished', s.finished],
    ['Final verdict', s.final_verdict],
    ['Whole run, budget (min)', s.run_total.budget_min], ['Whole run, actual (min)', s.run_total.actual_min],
    ['Whole run, error (%)', s.run_total.error_pct], ['Tokens', s.run_total.tokens],
    ['Planning, budget / actual (min)', `${cell(s.planning.budget_min)} / ${cell(s.planning.actual_min)}`],
  ]), '');
  out.push('## Waves', '', table(['Wave', 'Workers', 'Budget (min)', 'Actual (min)', 'Error (%)', 'Cause'],
    s.waves.map((w) => [w.wave, w.workers.join(', '), w.budget_min, w.actual_min, w.error_pct, w.cause])), '');
  out.push('## Workers', '', table(
    ['Id', 'Wave', 'Size', 'Model', 'Effort', 'Files', 'Criteria', 'Budget', 'Actual', 'Ratio', 'Attempts', 'Status', 'Blocked', 'Verify (min)', 'Verdict', 'Tokens'],
    s.workers.map((w) => [w.id, w.wave, w.size, w.model, w.effort, w.files, w.criteria, w.budget_min, w.actual_min, w.ratio, w.attempts, w.status, w.blocked, w.verify_min, w.verdict, w.tokens])), '');
  out.push('## Gates (min)', '', table(['Gate', 'Runs'], Object.entries(s.gates).map(([k, v]) => [k, v.join(', ')])), '');
  out.push('## Prediction accuracy', '', table(['Measure', 'Value'], [
    ['Workers measured', s.accuracy.workers_measured],
    ['Mean absolute error (%)', s.accuracy.mean_abs_error_pct],
    ['Over budget', s.accuracy.over_budget.join(', ') || 'none'],
    ['Under half of budget (review how it was set)', s.accuracy.under_half_budget.join(', ') || 'none'],
  ]), '');
  if (s.blocked.length) out.push('## BLOCKED reports', '', table(['Worker', 'Missing'], s.blocked.map((b) => [b.id, b.missing])), '');
  if (s.consent.length) out.push('## Model consent', '', table(['Role', 'From', 'To', 'Decision'], s.consent.map((c) => [c.role, c.from, c.to, c.decision])), '');
  if (s.unplanned_files.length) out.push('## Unplanned files', '', ...s.unplanned_files.map((f) => `- ${f}`), '');
  return `${out.join('\n')}\n`;
}

// -------------------------------------------------------------- calibration

export function calibrate(logDir) {
  const groups = {};
  if (fs.existsSync(logDir)) {
    for (const f of fs.readdirSync(logDir).filter((n) => n.endsWith('.run-stats.json'))) {
      let s;
      try { s = JSON.parse(fs.readFileSync(path.join(logDir, f), 'utf8')); } catch { continue; }
      for (const w of s.workers || []) {
        if (w.status !== 'done' || w.actual_min == null || !w.size) continue;
        const key = `${w.size}|${tierOf(w.model)}|${w.effort}`;
        (groups[key] = groups[key] || []).push(w);
      }
    }
  }
  const result = { updated: new Date().toISOString(), margin: CALIBRATION_MARGIN, min_samples: CALIBRATION_MIN_SAMPLES, groups: {} };
  for (const [key, ws] of Object.entries(groups)) {
    result.groups[key] = {
      n: ws.length,
      medianMin: round1(median(ws.map((w) => w.actual_min))),
      medianRatio: round1(median(ws.filter((w) => w.ratio != null).map((w) => w.ratio))),
    };
  }
  return result;
}

function loadCalibration(logDir) {
  try { return JSON.parse(fs.readFileSync(path.join(logDir, 'budget-calibration.json'), 'utf8')); } catch { return null; }
}

// ---------------------------------------------------------------------- CLI

function parseArgv(argv) {
  const [cmd, ...rest] = argv;
  const opts = {};
  const kv = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--print') opts.print = true;
    else if (a.startsWith('--')) { opts[a.slice(2)] = rest[i + 1]; i++; }
    else if (a.includes('=')) { const j = a.indexOf('='); kv[a.slice(0, j)] = coerce(a.slice(j + 1)); }
    else pos.push(a);
  }
  return { cmd, opts, kv, pos };
}

function localDate(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function main(argv, { now = () => Date.now() } = {}) {
  const { cmd, opts, kv, pos } = parseArgv(argv);
  const stateDir = opts.dir || '.engineer';
  const logDir = opts.log || 'docs/verification-log';
  const eventsFile = () => {
    if (!opts.run) throw new Error('--run <slug> is required');
    return path.join(stateDir, opts.run, 'events.jsonl');
  };
  const ts = () => (typeof kv.ts === 'number' ? kv.ts : now());

  switch (cmd) {
    case 'start': {
      appendEvent(eventsFile(), { type: 'start', ts: ts(), run: opts.run, ...kv });
      return `run ${opts.run} started`;
    }
    case 'event': {
      const type = pos[0];
      if (!type) throw new Error('event type required');
      const { ts: _ignored, ...rest } = kv;
      appendEvent(eventsFile(), { type, ts: ts(), ...rest });
      return `recorded ${type}`;
    }
    case 'budgets': {
      const events = readEvents(eventsFile());
      const b = computeBudgets(events, {
        orchestrator: kv.orchestrator, baselineGateMin: kv.baseline_gate_min, fullGateMin: kv.full_gate_min,
        verifier: kv.verifier, finalVerifier: kv.final_verifier, calibration: loadCalibration(logDir),
      });
      appendEvent(eventsFile(), { type: 'budget-plan', ts: ts(), ...b });
      return JSON.stringify(b, null, 2);
    }
    case 'suggest': {
      return JSON.stringify(suggestBudget({ size: kv.size, model: kv.model, effort: kv.effort, calibration: loadCalibration(logDir) }));
    }
    case 'tier-check': {
      const r = tierCheck(kv.orchestrator, kv.requested);
      if (!r.ok) { const e = new Error(r.message); e.exitCode = 3; throw e; }
      return r.message;
    }
    case 'calibrate': {
      const c = calibrate(logDir);
      fs.mkdirSync(logDir, { recursive: true });
      fs.writeFileSync(path.join(logDir, 'budget-calibration.json'), `${JSON.stringify(c, null, 2)}\n`);
      return `calibration written (${Object.keys(c.groups).length} groups)`;
    }
    case 'finish': {
      appendEvent(eventsFile(), { type: 'finish', ts: ts(), verdict: kv.verdict });
      const stats = computeStats(readEvents(eventsFile()));
      fs.mkdirSync(logDir, { recursive: true });
      const base = path.join(logDir, `${localDate(ts())}-${opts.run}.run-stats`);
      fs.writeFileSync(`${base}.json`, `${JSON.stringify(stats, null, 2)}\n`);
      const md = renderMarkdown(stats);
      fs.writeFileSync(`${base}.md`, md);
      const c = calibrate(logDir);
      fs.writeFileSync(path.join(logDir, 'budget-calibration.json'), `${JSON.stringify(c, null, 2)}\n`);
      return opts.print ? md : `wrote ${base}.md and ${base}.json`;
    }
    default:
      throw new Error(`unknown command "${cmd}". See the header of this file for usage.`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`engineer-stats: ${err.message}`);
    process.exit(err.exitCode || 1);
  }
}
