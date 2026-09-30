// compareImages runs inside a real Chromium page (see imgdiff.mjs), this
// needs Playwright + a launchable browser, so the whole file no-ops with a
// clear skip reason when neither is available, rather than failing the
// whole suite in an environment that hasn't run `npx playwright install`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { compareImages } from '../imgdiff.mjs';
import { launchChromium } from '../lib/browser.mjs';

let playwright;
try {
  // Same import shape imgdiff.mjs's caller (capture.mjs) uses, playwright
  // exposes .chromium directly off the module object, no .default needed.
  playwright = await import('playwright');
} catch {
  playwright = null;
}

const skip = !playwright ? 'playwright is not installed' : false;

// This package has no PNG-encoding dependency of its own (deliberately,
// see imgdiff.mjs's header comment about avoiding an image-diff library),
// so tiny solid-color fixture PNGs are drawn with the same Chromium canvas
// imgdiff.mjs uses at runtime, via a throwaway page.
async function writeSolidPng(dir, name, [r, g, b], browser) {
  const page = await browser.newPage();
  const dataUrl = await page.evaluate(([rr, gg, bb]) => {
    const canvas = document.createElement('canvas');
    canvas.width = 8;
    canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = `rgb(${rr},${gg},${bb})`;
    ctx.fillRect(0, 0, 8, 8);
    return canvas.toDataURL('image/png');
  }, [r, g, b]);
  await page.close();
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, Buffer.from(base64, 'base64'));
  return filePath;
}

test('compareImages: identical images score 0', { skip }, async () => {
  const browser = await launchChromium(playwright);
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-imgdiff-'));
    const a = await writeSolidPng(dir, 'a.png', [51, 102, 204], browser);
    const b = await writeSolidPng(dir, 'b.png', [51, 102, 204], browser);

    const page = await browser.newPage();
    const score = await compareImages(page, a, b);
    await page.close();
    await fs.rm(dir, { recursive: true, force: true });

    assert.equal(score, 0);
  } finally {
    await browser.close();
  }
});

test('compareImages: a clear color change scores well above zero', { skip }, async () => {
  const browser = await launchChromium(playwright);
  try {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pr-review-imgdiff-'));
    const a = await writeSolidPng(dir, 'a.png', [51, 102, 204], browser);
    const b = await writeSolidPng(dir, 'b.png', [204, 102, 51], browser);

    const page = await browser.newPage();
    const score = await compareImages(page, a, b);
    await page.close();
    await fs.rm(dir, { recursive: true, force: true });

    assert.ok(score > 0.1, `expected a clear color change to score well above 0, got ${score}`);
  } finally {
    await browser.close();
  }
});
