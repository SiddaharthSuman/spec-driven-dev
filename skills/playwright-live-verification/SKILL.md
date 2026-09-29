---
name: playwright-live-verification
description:
  Use when verifying a UI change in a real browser with Playwright (running or
  writing e2e specs, or manually checking that a route works) and you need an
  authenticated app session without going through a real login, or you are
  about to re-download the Chromium binary Playwright needs.
---

# Playwright Live Browser Verification

This skill is generic. Anything specific to one app (its auth mechanism, its
storage keys, its endpoints) comes from that project's own e2e specs, its
`AGENTS.md`, or its `.claude/skills/`. Do not assume any particular login
system.

## One-time Chromium install: don't re-download every session

```bash
npx playwright install chromium
```

Browsers cache to an OS-specific folder, not the project directory:

- macOS: `~/Library/Caches/ms-playwright`
- Linux: `~/.cache/ms-playwright`
- Windows: `%USERPROFILE%\AppData\Local\ms-playwright`

The first download is roughly 270MB for Chromium. Check whether the cache
folder above is already populated before running `install` again in a fresh
session. If it is, the command is a no-op, so skip it.

If Playwright wants a Chromium build that is not on disk but the machine has
one at a fixed path (a CI image, a sandbox), the pr-review pipeline reads
`PR_REVIEW_CHROMIUM_PATH` for that. For your own specs use Playwright's
`executablePath` launch option.

## Getting an authenticated session without a real login

First find out how the app decides you are signed in, from the project itself:
existing specs under `e2e/`, the auth provider or guard in `src/`, and any
project-local skill that documents it. Then pick the smallest fake that
satisfies that check. In order of preference:

1. **Reuse the project's existing e2e pattern.** If a spec already
   authenticates, copy it exactly.
2. **Seed the client state the app reads, before any app code runs:**

   ```ts
   await page.addInitScript(() => {
     localStorage.setItem("<key the app reads>", "<value>");
   });
   ```

   `addInitScript` runs before the page's own scripts, so the value is already
   there when the app's startup code looks for it.

3. **Mock the call that validates the session**, when the app confirms a token
   with the backend on load:

   ```ts
   await page.route("**/<session-check-endpoint>**", (route) =>
     route.fulfill({
       status: 200,
       contentType: "application/json",
       body: JSON.stringify({ success: true }),
     }),
   );
   ```

   Without this, a real backend rejects a token it never issued and the app
   bounces back to logged out.

4. **Mock the current-user or profile call too** if a specific name or role
   matters for what you are verifying.

Then `await page.goto('/')`.

### Verifying against real backend data instead of mocks

Skip the route mocks. Capture a real token once from an interactive login
(`page.evaluate(() => localStorage.getItem('<key>'))`) and put it in the same
`addInitScript`. To reuse it across runs, persist it with Playwright's
`context.storageState({ path })`, which captures `localStorage` (not
`sessionStorage`) and cookies.

### The pr-review capture command

`pr-review`'s `capture` command takes the same setup as data: an `auth` block
in the capture plan (`localStorage`, optional `roleKey`, and `routes` to fulfill).
See the pr-review README's "Capture-plan JSON". The mechanism is identical to
options 2 and 3 above.

## What to wait for after navigating

Apps often render a loader and block their children until a session check
resolves. Don't assert immediately after `page.goto('/')`. Wait for something
that only renders once authenticated and loaded:

```ts
await expect(
  page.getByRole("heading", {
    name: /<text that only appears when signed in>/i,
  }),
).toBeVisible();
```

A fixed `waitForTimeout`, or asserting on the loader itself, is both slower and
flakier than waiting on real content.

## Quick checklist

- [ ] `npx playwright install chromium` already run once. Check the cache
      folder above before re-running.
- [ ] You found how this app checks for a session, rather than assuming.
- [ ] Session state is seeded with `addInitScript` before `page.goto`.
- [ ] Either the session-check call is mocked (mocked-data path) or a real
      captured token is used with no mock (real-data path), not both.
- [ ] Identity-dependent checks also mock the current-user call.
- [ ] Assertions wait on real authenticated content, not a timeout or the
      loader.
