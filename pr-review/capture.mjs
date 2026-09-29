// `capture` runs a capture plan against both a base and a head dev server
// with Playwright + Chromium, classifies each scenario, and writes
// visual.json. See README.md's "capture" section and "Capture-plan JSON".
//
// Nothing here is specific to one app. Anything an app needs to get past a
// login or to show data comes from the plan itself:
//
//   plan.auth    optional session setup applied to every scenario
//     localStorage   { key: value } written before any page script runs
//     roleKey        localStorage key that receives a scenario's `role`
//     routes         [{ url, method?, status?, json | body, contentType? }]
//   scenario.mocks   { "METHOD url-glob": { status?, json | body } } API mocks
//   plan.devCommand  command shown in visual.json's "try it" steps
//   plan.knownLimits extra known limits to list in visual.json
//
// With no plan.auth and no mocks, pages load exactly as the dev server serves
// them. A scenario that ends up on a login screen is classified "unreliable".

import path from 'node:path';
import fs from 'node:fs/promises';
import { compareImages } from './imgdiff.mjs';
import { launchChromium } from './lib/browser.mjs';

const NOISE_FACTOR = 3; // a diff below noiseFloor * this factor reads as "unchanged"

// Turns a mock spec into { method, glob, response } or null when it has no
// payload. Keys look like "GET **/api/items**" or just "**/api/items**".
export function parseMock(key, value) {
  if (!value || typeof value !== 'object') return null;
  if (value.json === undefined && value.body === undefined) return null;
  const m = /^(GET|POST|PUT|PATCH|DELETE)\s+(.+)$/i.exec(key.trim());
  return {
    method: m ? m[1].toUpperCase() : null,
    glob: m ? m[2].trim() : key.trim(),
    response: value,
  };
}

async function fulfillRoutes(page, entries) {
  for (const { method, glob, response } of entries) {
    await page.route(glob, (route) => {
      if (method && route.request().method() !== method) return route.fallback();
      const hasJson = response.json !== undefined;
      return route.fulfill({
        status: response.status ?? 200,
        contentType: response.contentType ?? (hasJson ? 'application/json' : 'text/plain'),
        body: hasJson ? JSON.stringify(response.json) : String(response.body),
      });
    });
  }
}

export async function primePage(page, plan, scenario) {
  const auth = plan.auth ?? {};
  const storage = { ...(auth.localStorage ?? {}) };
  if (auth.roleKey && scenario.role) storage[auth.roleKey] = scenario.role;
  if (Object.keys(storage).length > 0) {
    await page.addInitScript((entries) => {
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
    }, storage);
  }

  const authRoutes = (auth.routes ?? []).map((r) => ({
    method: r.method ? String(r.method).toUpperCase() : null,
    glob: r.url,
    response: r,
  }));
  await fulfillRoutes(page, authRoutes);

  const mocks = Object.entries(scenario.mocks ?? {})
    .map(([k, v]) => parseMock(k, v))
    .filter(Boolean);
  await fulfillRoutes(page, mocks);
}

async function runSteps(page, baseUrl, scenario, sideOverride, outDir, shotPrefix) {
  const shots = [];
  const route = sideOverride?.route ?? scenario.route;

  for (const step of scenario.steps) {
    switch (step.type) {
      case 'goto':
        await page.goto(new URL(route, baseUrl).toString(), { waitUntil: 'domcontentloaded' });
        break;
      case 'click':
        await page.locator(step.selector).click();
        break;
      case 'fill':
        await page.locator(step.selector).fill(step.value ?? '');
        break;
      case 'press':
        await page.keyboard.press(step.key);
        break;
      case 'waitFor':
        await page.locator(step.selector).first().waitFor({ timeout: 10_000 });
        break;
      case 'shot': {
        const shotPath = path.join(outDir, `${shotPrefix}.${shots.length}.png`);
        await page.screenshot({ path: shotPath, animations: 'disabled' });
        shots.push(shotPath);
        break;
      }
      default:
        throw new Error(`unknown step type "${step.type}"`);
    }
  }
  return shots;
}

function looksUnreliable(page) {
  const url = page.url();
  if (/\/login(\/|$|\?)/.test(url)) return 'redirected to login';
  return null;
}

export function buildKnownLimits(plan) {
  const limits = [];
  const usesAuth = plan.auth && (Object.keys(plan.auth.localStorage ?? {}).length > 0 || (plan.auth.routes ?? []).length > 0);
  if (usesAuth) limits.push('Authentication is mocked from the capture plan, not a real login.');
  const usesMocks = (plan.scenarios ?? []).some((s) => Object.entries(s.mocks ?? {}).some(([k, v]) => parseMock(k, v)));
  if (usesMocks) limits.push('API responses listed in the plan are mocked, not live data.');
  if (Array.isArray(plan.knownLimits)) limits.push(...plan.knownLimits.map(String));
  return limits;
}

export async function capture(args) {
  const { plan: planPath, base: baseUrl, head: headUrl, out } = args;
  if (!planPath || !baseUrl || !headUrl || !out) {
    console.error('capture requires --plan --base --head --out');
    process.exitCode = 1;
    return;
  }

  const plan = JSON.parse(await fs.readFile(path.resolve(planPath), 'utf8'));
  const outDir = path.resolve(out);
  await fs.mkdir(outDir, { recursive: true });

  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    console.error('capture requires the "playwright" package. Run: npx playwright install chromium');
    process.exitCode = 1;
    return;
  }

  const browser = await launchChromium(playwright);
  const scenarios = [];

  for (const scenario of plan.scenarios ?? []) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();

    try {
      await primePage(page, plan, scenario);

      // Shoot base twice first, to measure this scenario's own noise floor
      // (anti-aliasing jitter, font hinting) before comparing against head.
      const baseShots1 = await runSteps(page, baseUrl, scenario, scenario.base, outDir, `${scenario.name}.base1`);
      const baseUnreliable = looksUnreliable(page);
      const baseShots2 = await runSteps(page, baseUrl, scenario, scenario.base, outDir, `${scenario.name}.base2`);

      const headShots = await runSteps(page, headUrl, scenario, scenario.head, outDir, `${scenario.name}.head`);
      const headUnreliable = looksUnreliable(page);

      const lastBase1 = baseShots1[baseShots1.length - 1];
      const lastBase2 = baseShots2[baseShots2.length - 1];
      const lastHead = headShots[headShots.length - 1];

      const noiseFloor = lastBase1 && lastBase2 ? await compareImages(page, lastBase1, lastBase2) : 0;
      const diffScore = lastBase2 && lastHead ? await compareImages(page, lastBase2, lastHead) : 1;

      let status;
      if (baseUnreliable || headUnreliable) status = 'unreliable';
      else if (diffScore <= noiseFloor * NOISE_FACTOR) status = 'unchanged';
      else status = 'captured';

      // Rename the final base2 shot to the stable "<name>.base.png" name
      // that visual.json references, and drop the throwaway first-pass shot.
      const basePath = path.join(outDir, `${scenario.name}.base.png`);
      const headPath = path.join(outDir, `${scenario.name}.head.png`);
      if (lastBase2) await fs.rename(lastBase2, basePath);
      if (lastHead) await fs.rename(lastHead, headPath);
      for (const shot of baseShots1) await fs.rm(shot, { force: true });

      scenarios.push({
        name: scenario.name,
        status,
        basePath: path.relative(outDir, basePath),
        headPath: path.relative(outDir, headPath),
        noiseFloor: Number(noiseFloor.toFixed(4)),
        diffScore: Number(diffScore.toFixed(4)),
        note: baseUnreliable || headUnreliable || undefined,
      });
    } catch (err) {
      scenarios.push({
        name: scenario.name,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      await context.close();
    }
  }

  await browser.close();

  const visual = {
    scenarios,
    tryIt: [
      'git fetch origin pull/<PR>/head:pr-<PR> && git checkout pr-<PR>',
      plan.devCommand ?? "start the dev server (the command is in the project's AGENTS.md)",
      `open ${headUrl}`,
    ],
    knownLimits: buildKnownLimits(plan),
  };
  if (args.baseCaption) visual.baseCaption = args.baseCaption;
  if (args.headCaption) visual.headCaption = args.headCaption;

  await fs.writeFile(path.join(outDir, 'visual.json'), JSON.stringify(visual, null, 2));

  const counts = scenarios.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});
  console.log(JSON.stringify({ total: scenarios.length, ...counts, out: path.join(outDir, 'visual.json') }));
}
