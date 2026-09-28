// `capture` — runs a capture plan against both a base and a head dev
// server with Playwright + Chromium, classifies each scenario, and writes
// visual.json. See README.md's "capture" section and "Capture-plan JSON".
//
// Auth: uses the exact same mocked-session pattern documented in the
// playwright-live-verification skill (_meta in localStorage + a mocked
// /invoke route) rather than a real MSAL login, since this is screenshot
// capture, not a real auth test.

import path from 'node:path';
import fs from 'node:fs/promises';
import { compareImages } from './imgdiff.mjs';
import { launchChromium } from './lib/browser.mjs';

// Broad enough to satisfy every route guard the app defines, so a capture
// never dead-ends on an authorization check. Adjust this list if the app
// adds a role capture doesn't yet cover.
const SUPER_ROLES = ['Astra'];

const NOISE_FACTOR = 3; // a diff below noiseFloor * this factor reads as "unchanged"

async function primePage(page, role) {
  await page.addInitScript((r) => {
    localStorage.setItem('_meta', 'pr-review-e2e-token');
    if (r) localStorage.setItem('app_role_selected', r);
  }, role ?? SUPER_ROLES[0]);
  await page.route('**/api/v1/invoke**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    })
  );
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
    console.error('capture requires the "playwright" package — run: npx playwright install chromium');
    process.exitCode = 1;
    return;
  }

  const browser = await launchChromium(playwright);
  const scenarios = [];

  for (const scenario of plan.scenarios ?? []) {
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    await primePage(page, scenario.role);

    try {
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
      `git fetch origin pull/<PR>/head:pr-<PR> && git checkout pr-<PR>`,
      'pnpm dev',
      `open ${headUrl}`,
    ],
    knownLimits: [
      'API responses are mocked from src/services/*.api.ts shapes, not live data.',
      'useUser() is stubbed — a PR touching src/hooks/useUser.ts cannot be verified visually.',
    ],
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
