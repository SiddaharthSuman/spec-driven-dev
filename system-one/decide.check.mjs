import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { decide, validateQuestions, validateAnswers } from './decide.mjs';

const questions = {
  tier: { type: 'choice', instructions: 'Pick a tier', criteria: { mechanical: 'no judgment', judgment: 'needs judgment' } },
  risky: { type: 'noul', instructions: 'Is this risky?' },
  size: { type: 'score', instructions: 'How big?', criteria: ['tiny', 'small', 'large'] },
};
const good = { model: 'x-1', answers: { tier: { type: 'choice', choice: 'mechanical' }, risky: { type: 'noul', noul: 0.1 }, size: { type: 'score', score: 1 } } };

function server(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve(s));
  });
}
const urlOf = (s) => `http://127.0.0.1:${s.address().port}`;

test('validateQuestions accepts the three shapes and rejects bad ones', () => {
  assert.equal(validateQuestions(questions), null);
  assert.match(validateQuestions({}), /empty/);
  assert.match(validateQuestions({ a: { type: 'choice', criteria: { one: '1' } } }), /2 to 255/);
  assert.match(validateQuestions({ a: { type: 'score', criteria: ['x'] } }), /2 to 10/);
  assert.match(validateQuestions({ a: { type: 'text' } }), /unknown type/);
});

test('validateAnswers rejects a choice outside the options and a missing answer', () => {
  assert.equal(validateAnswers(questions, good), null);
  const bad = structuredClone(good);
  bad.answers.tier.choice = 'other';
  assert.match(validateAnswers(questions, bad), /not one of the options/);
  delete bad.answers.size;
  assert.match(validateAnswers(questions, { answers: bad.answers }), /no answer|not one/);
});

test('laya answers first when it responds with a valid reply', async () => {
  let seen;
  const s = await server((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen = { url: req.url, body: JSON.parse(body) };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(good));
    });
  });
  try {
    const r = await decide({ state: 'diff text', questions }, { env: { LAYA_ENDPOINT: urlOf(s) } });
    assert.equal(r.available, true);
    assert.equal(r.source, 'laya');
    assert.equal(r.answers.tier.choice, 'mechanical');
    assert.equal(seen.url, '/systemone');
    assert.equal(seen.body.state, 'diff text');
  } finally {
    s.close();
  }
});

test('falls through to jev when laya is down and a key is set, sending a bearer token', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, init });
    if (url.startsWith('http://127.0.0.1:1')) throw new Error('refused');
    return { ok: true, json: async () => good };
  };
  const r = await decide(
    { state: 's', questions },
    { env: { LAYA_ENDPOINT: 'http://127.0.0.1:1', TYPESAFE_API_KEY: 'k123' }, fetch: fakeFetch },
  );
  assert.equal(r.available, true);
  assert.equal(r.source, 'jev');
  const jev = calls[1];
  assert.equal(jev.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(jev.init.headers.Authorization, 'Bearer k123');
  assert.equal(JSON.parse(jev.init.body).model, 'jev-latest');
});

test('neither configured: unavailable, fast, no throw, and jev is never contacted', async () => {
  const urls = [];
  const fakeFetch = async (url) => {
    urls.push(url);
    throw new Error('refused');
  };
  const t0 = Date.now();
  const r = await decide({ state: 's', questions }, { env: {}, fetch: fakeFetch });
  assert.equal(r.available, false);
  assert.match(r.reason, /laya: unreachable/);
  assert.match(r.reason, /no TYPESAFE_API_KEY/);
  assert.equal(urls.length, 1);
  assert.ok(Date.now() - t0 < 500);
});

test('a slow laya times out and does not hang the caller', async () => {
  const s = await server(() => {});
  try {
    const t0 = Date.now();
    const r = await decide({ state: 's', questions }, { env: { LAYA_ENDPOINT: urlOf(s), LAYA_TIMEOUT_MS: '100' } });
    assert.equal(r.available, false);
    assert.match(r.reason, /laya: timeout/);
    assert.ok(Date.now() - t0 < 1000);
  } finally {
    s.closeAllConnections?.();
    s.close();
  }
});

test('an invalid laya reply is ignored and jev is used instead', async () => {
  const fakeFetch = async (url) => {
    if (url.includes('127.0.0.1')) return { ok: true, json: async () => ({ answers: { tier: { choice: 'nope' } } }) };
    return { ok: true, json: async () => good };
  };
  const r = await decide({ state: 's', questions }, { env: { TYPESAFE_API_KEY: 'k' }, fetch: fakeFetch });
  assert.equal(r.source, 'jev');
});

test('bad input never throws', async () => {
  assert.deepEqual(await decide(null, { env: {} }), { available: false, reason: 'state is required' });
  assert.match((await decide({ state: 's', questions: {} }, { env: {} })).reason, /empty/);
  assert.equal((await decide({ state: 's', questions }, { env: {}, fetch: 'nope' })).available, false);
});
