// `quality-gate` — headless-browser acceptance checks on a rendered
// report.html, run by `finish` before a report counts as "delivered". See
// README.md's "Quality gate" section for the exact rule list. A hard gate,
// not a lint suggestion — never relax a check here to make a report pass;
// fix the template in render/ instead.

import path from 'node:path';
import { launchChromium } from './lib/browser.mjs';

const MIN_CONTRAST = 4.5; // WCAG AA, normal text

function hexToRgb(hex) {
  const clean = hex.trim().replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function relativeLuminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(hexA, hexB) {
  const lA = relativeLuminance(hexToRgb(hexA));
  const lB = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = lA > lB ? [lA, lB] : [lB, lA];
  return (lighter + 0.05) / (darker + 0.05);
}

// The pairs report.css actually renders text against — kept in sync with
// the --variable names in render/report.css by hand, since this gate is
// what catches a drift between the two.
const CONTRAST_PAIRS = [
  ['--text', '--bg'],
  ['--text-muted', '--bg'],
  ['--link', '--bg'],
  ['--blocking', '--blocking-bg'],
  ['--high', '--high-bg'],
  ['--medium', '--medium-bg'],
  ['--pass', '--pass-bg'],
];

async function checkContrast(page, theme) {
  if (theme === 'dark') {
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
  }
  const failures = await page.evaluate((pairs) => {
    const style = getComputedStyle(document.documentElement);
    return pairs.map(([fg, bg]) => [fg, bg, style.getPropertyValue(fg).trim(), style.getPropertyValue(bg).trim()]);
  }, CONTRAST_PAIRS);

  const results = [];
  for (const [fg, bg, fgHex, bgHex] of failures) {
    if (!fgHex || !bgHex) {
      results.push(`${theme}: could not read ${fg}/${bg} from computed style`);
      continue;
    }
    const ratio = contrastRatio(fgHex, bgHex);
    if (ratio < MIN_CONTRAST) {
      results.push(`${theme}: ${fg} on ${bg} has contrast ${ratio.toFixed(2)} (needs ${MIN_CONTRAST})`);
    }
  }
  if (theme === 'dark') {
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  }
  return results;
}

async function checkNoHorizontalScroll(page, width) {
  await page.setViewportSize({ width, height: 900 });
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  return scrollWidth <= clientWidth + 1
    ? null
    : `horizontal scroll at ${width}px (scrollWidth ${scrollWidth} > clientWidth ${clientWidth})`;
}

async function checkImagesLoad(page) {
  const broken = await page.evaluate(() =>
    [...document.images].filter((img) => img.naturalWidth === 0).map((img) => img.src)
  );
  return broken.map((src) => `image failed to load: ${src}`);
}

async function checkInternalRefs(page) {
  return page.evaluate(() => {
    const failures = [];
    const idExists = (id) => Boolean(document.getElementById(id));

    for (const el of document.querySelectorAll('[aria-labelledby]')) {
      for (const id of el.getAttribute('aria-labelledby').split(/\s+/).filter(Boolean)) {
        if (!idExists(id)) failures.push(`aria-labelledby="${id}" has no matching element`);
      }
    }
    for (const a of document.querySelectorAll('a[href^="#"]')) {
      const id = a.getAttribute('href').slice(1);
      if (id && !idExists(id)) failures.push(`href="#${id}" has no matching element`);
    }
    for (const use of document.querySelectorAll('use')) {
      const href = use.getAttribute('href') || use.getAttribute('xlink:href');
      if (href && href.startsWith('#') && !idExists(href.slice(1))) {
        failures.push(`<use> href="${href}" has no matching element`);
      }
    }
    for (const el of document.querySelectorAll('[style*="marker-end"]')) {
      const match = el.getAttribute('style').match(/marker-end:\s*url\(#([^)]+)\)/);
      if (match && !idExists(match[1])) failures.push(`marker-end #${match[1]} has no matching element`);
    }
    return failures;
  });
}

async function checkSingleH1WithLang(page) {
  return page.evaluate(() => {
    const h1s = document.querySelectorAll('h1');
    if (h1s.length !== 1) return [`expected exactly one <h1>, found ${h1s.length}`];
    if (!h1s[0].getAttribute('lang')) return ['the <h1> is missing a lang attribute'];
    return [];
  });
}

async function checkCopyButton(page) {
  const hasButton = await page.evaluate(() => Boolean(document.getElementById('copy-md-btn')));
  if (!hasButton) return ['#copy-md-btn is missing'];
  await page.click('#copy-md-btn');
  try {
    // The click handler awaits an async clipboard write before setting
    // this attribute — waitForFunction (not an immediate read) is required
    // so this check isn't racing that await.
    await page.waitForFunction(
      () => document.getElementById('copy-md-btn').dataset.copied === 'true',
      { timeout: 2000 }
    );
    return [];
  } catch {
    return ['clicking #copy-md-btn did not set data-copied="true" within 2s'];
  }
}

export async function runGate(htmlPath) {
  let playwright;
  try {
    playwright = await import('playwright');
  } catch {
    return { ok: false, failures: ['playwright is not installed — cannot run the quality gate'] };
  }

  const browser = await launchChromium(playwright);
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-write', 'clipboard-read']);
  const page = await context.newPage();

  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(err.message));

  const failures = [];

  try {
    await page.goto(`file://${path.resolve(htmlPath)}`, { waitUntil: 'load' });

    const scroll1280 = await checkNoHorizontalScroll(page, 1280);
    if (scroll1280) failures.push(scroll1280);
    const scroll400 = await checkNoHorizontalScroll(page, 400);
    if (scroll400) failures.push(scroll400);

    failures.push(...(await checkImagesLoad(page)));
    failures.push(...(await checkInternalRefs(page)));
    failures.push(...(await checkSingleH1WithLang(page)));
    failures.push(...(await checkCopyButton(page)));
    failures.push(...(await checkContrast(page, 'light')));
    failures.push(...(await checkContrast(page, 'dark')));

    if (consoleErrors.length > 0) {
      failures.push(...consoleErrors.map((e) => `console error: ${e}`));
    }
  } catch (err) {
    failures.push(`quality gate crashed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await browser.close();
  }

  return { ok: failures.length === 0, failures };
}
