#!/usr/bin/env node
// System One decision helper. Optional acceleration, never a dependency.
//
// Contract: decide({ state, questions }) resolves to either
//   { available: true,  source: 'laya' | 'jev', model, answers }
//   { available: false, reason }
// It never throws and never hangs: every network call has a short timeout.
// Callers use the answers when available, and otherwise decide for themselves
// on their own judgment exactly as they would with no helper at all.
//
// Order: Laya (local, LAYA_ENDPOINT, default http://127.0.0.1:8765), then Jev
// (hosted, only when TYPESAFE_API_KEY is set), then unavailable.
//
// Wire format is the TypeSafe System One HTTP API (POST /systemone with
// { state, model, questions }, verified against docs.typesafe.ai). Laya is
// assumed to accept the same request at LAYA_PATH (default /systemone). That
// assumption is not verified, so a Laya reply that does not validate is treated
// as unavailable and falls through to Jev.
//
// Question shapes (same as TypeSafe):
//   noul:   { type: 'noul', instructions }                  -> answers[id].noul in 0..1
//   choice: { type: 'choice', instructions, criteria: {option: description} }
//                                                           -> answers[id].choice is a criteria key
//   score:  { type: 'score', instructions, criteria: [level, ...] (2 to 10) }
//                                                           -> answers[id].score is a number
//
// CLI: node decide.mjs [--input file.json]   (JSON on stdin when no --input)
// Always exits 0 and prints one JSON object, so a caller never has to handle a failure.

import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULTS = {
  layaEndpoint: 'http://127.0.0.1:8765',
  layaPath: '/systemone',
  layaTimeoutMs: 300,
  jevBase: 'https://api.typesafe.ai/v1',
  jevModel: 'jev-latest',
  jevTimeoutMs: 2000,
};

export function validateQuestions(questions) {
  if (!questions || typeof questions !== 'object' || Array.isArray(questions)) {
    return 'questions must be an object keyed by question id';
  }
  const ids = Object.keys(questions);
  if (ids.length === 0) return 'questions is empty';
  for (const id of ids) {
    const q = questions[id];
    if (!q || typeof q !== 'object') return `question ${id} must be an object`;
    if (!['noul', 'choice', 'score'].includes(q.type)) return `question ${id} has unknown type`;
    if (q.type === 'choice') {
      const keys = q.criteria && typeof q.criteria === 'object' && !Array.isArray(q.criteria) ? Object.keys(q.criteria) : [];
      if (keys.length < 2 || keys.length > 255) return `question ${id} needs 2 to 255 criteria options`;
    }
    if (q.type === 'score') {
      if (!Array.isArray(q.criteria) || q.criteria.length < 2 || q.criteria.length > 10) {
        return `question ${id} needs 2 to 10 score levels`;
      }
    }
  }
  return null;
}

// Returns an error string when the reply does not fit the questions, else null.
export function validateAnswers(questions, reply) {
  const answers = reply && reply.answers;
  if (!answers || typeof answers !== 'object') return 'reply has no answers';
  for (const [id, q] of Object.entries(questions)) {
    const a = answers[id];
    if (!a || typeof a !== 'object') return `no answer for ${id}`;
    if (q.type === 'noul' && !(typeof a.noul === 'number' && a.noul >= 0 && a.noul <= 1)) return `bad noul answer for ${id}`;
    if (q.type === 'choice' && !(typeof a.choice === 'string' && Object.hasOwn(q.criteria, a.choice))) {
      return `choice for ${id} is not one of the options`;
    }
    if (q.type === 'score' && typeof a.score !== 'number') return `bad score answer for ${id}`;
  }
  return null;
}

async function post(fetchImpl, url, headers, body, timeoutMs) {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

function envInt(env, name, fallback) {
  const n = Number.parseInt(env[name] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function decide(input, { env = process.env, fetch: fetchImpl = globalThis.fetch } = {}) {
  try {
    if (typeof fetchImpl !== 'function') return { available: false, reason: 'no fetch available' };
    if (!input || input.state === undefined || input.state === null) {
      return { available: false, reason: 'state is required' };
    }
    const bad = validateQuestions(input.questions);
    if (bad) return { available: false, reason: bad };

    const tried = [];

    // 1. Laya, local. Always tried first with a very short timeout.
    const layaBase = (env.LAYA_ENDPOINT || DEFAULTS.layaEndpoint).replace(/\/+$/, '');
    const layaPath = env.LAYA_PATH || DEFAULTS.layaPath;
    try {
      const reply = await post(
        fetchImpl,
        layaBase + layaPath,
        {},
        { state: input.state, model: env.LAYA_MODEL || 'laya', questions: input.questions },
        envInt(env, 'LAYA_TIMEOUT_MS', DEFAULTS.layaTimeoutMs),
      );
      const invalid = validateAnswers(input.questions, reply);
      if (!invalid) return { available: true, source: 'laya', model: reply.model ?? 'laya', answers: reply.answers };
      tried.push(`laya: ${invalid}`);
    } catch (err) {
      tried.push(`laya: ${err && err.name === 'TimeoutError' ? 'timeout' : 'unreachable'}`);
    }

    // 2. Jev, hosted. Only with an API key. Never assumed.
    const key = env.TYPESAFE_API_KEY;
    if (key) {
      try {
        const base = (env.TYPESAFE_BASE_URL || DEFAULTS.jevBase).replace(/\/+$/, '');
        const reply = await post(
          fetchImpl,
          `${base}/systemone`,
          { Authorization: `Bearer ${key}` },
          { state: input.state, model: env.JEV_MODEL || DEFAULTS.jevModel, questions: input.questions },
          envInt(env, 'JEV_TIMEOUT_MS', DEFAULTS.jevTimeoutMs),
        );
        const invalid = validateAnswers(input.questions, reply);
        if (!invalid) return { available: true, source: 'jev', model: reply.model ?? DEFAULTS.jevModel, answers: reply.answers };
        tried.push(`jev: ${invalid}`);
      } catch (err) {
        tried.push(`jev: ${err && err.name === 'TimeoutError' ? 'timeout' : String((err && err.message) || 'failed')}`);
      }
    } else {
      tried.push('jev: no TYPESAFE_API_KEY');
    }

    return { available: false, reason: tried.join('; ') };
  } catch (err) {
    return { available: false, reason: `unexpected: ${String((err && err.message) || err)}` };
  }
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node decide.mjs [--input file.json]\nReads {"state": ..., "questions": {...}} and prints one JSON result. Always exits 0.');
    return;
  }
  let raw;
  try {
    const i = argv.indexOf('--input');
    raw = i >= 0 ? fs.readFileSync(argv[i + 1], 'utf8') : await readStdin();
    console.log(JSON.stringify(await decide(JSON.parse(raw))));
  } catch (err) {
    console.log(JSON.stringify({ available: false, reason: `bad input: ${String((err && err.message) || err)}` }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
