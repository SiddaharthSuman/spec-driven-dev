// Shared Chromium launch used by capture.mjs and quality-gate.mjs. Prefers
// Playwright's own bundled browser, but falls back to a system-provided
// executable (e.g. a CI image or sandbox with its own pre-installed
// Chromium at a fixed path) when the version Playwright expects isn't the
// one actually on disk — set PR_REVIEW_CHROMIUM_PATH to point at it.

import fs from 'node:fs';

export async function launchChromium(playwright) {
  const overridePath = process.env.PR_REVIEW_CHROMIUM_PATH;
  if (overridePath && fs.existsSync(overridePath)) {
    return playwright.chromium.launch({ executablePath: overridePath });
  }
  return playwright.chromium.launch();
}
