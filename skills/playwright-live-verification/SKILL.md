---
name: playwright-live-verification
description:
  Use when verifying a UI change in a real browser with Playwright — running
  or writing e2e specs under e2e/*.spec.ts, or manually checking a route works
  — and you need an authenticated app session without going through a real
  MSAL login popup, or you're about to re-download the Chromium browser
  binary Playwright needs.
---

# Playwright Live Browser Verification

## One-time Chromium install — don't re-download every session

```bash
npx playwright install chromium
```

Browsers cache to an OS-specific folder, not the project directory:

- macOS: `~/Library/Caches/ms-playwright`
- Linux: `~/.cache/ms-playwright`
- Windows: `%USERPROFILE%\AppData\Local\ms-playwright`

First download is roughly 270MB for Chromium. Check whether the cache dir
above is already populated before running `install` again in a fresh
session — if it is, the command is a no-op, so skip it.

## Getting an authenticated session without a real MSAL login

`src/auth/MockAuthProvider.tsx` is, despite the name, the app's real
production auth provider (see its own header comment) — not a test double.
On mount it checks `localStorage._meta`; if present, it calls the real
backend's `/invoke` endpoint (`fetchWithTokenizedAuth(API_ENDPOINTS.invoke)`
in `src/services/tokenizedApi.ts`) and only sets `isAuthenticated = true`
once that call returns `{ success: true }`. A `_meta` value alone doesn't
authenticate you — the `/invoke` call still has to succeed.

The established pattern in this repo (see `e2e/HomePage.spec.ts`):

```ts
await page.addInitScript(() => {
  localStorage.setItem('_meta', 'e2e-token');
  localStorage.setItem('app_role_selected', 'Astra'); // only if a role gate is under test
});

await page.route('**/api/v1/invoke**', async route => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ success: true }),
  });
});

await page.goto('/');
```

- `addInitScript` runs before any app code on the page, so `_meta` already
  exists by the time `MockAuthProvider`'s mount effect reads it.
- The `/invoke` route mock is what actually flips `isAuthenticated` — without
  it, the real backend rejects a token it never issued and the session
  bounces back to logged-out.
- Real user identity does **not** come from `MockAuthProvider` (its `user`
  field is a hardcoded placeholder) — it comes from `useUser()`. If a
  specific name/role matters for what you're verifying, route-mock that too,
  the same way `HomePage.spec.ts` does for `**/src/hooks/useUser.ts*` and
  `**/api/v1/users/menupreferences**`.

### Verifying against real backend data instead of mocked

Skip the `/invoke` route mock. Instead put a *real* `_meta` token — captured
once from an actual interactive MSAL login via
`page.evaluate(() => localStorage.getItem('_meta'))` — into the same
`addInitScript`. The real `/invoke` call validates it against the real
backend, and every subsequent API call in the session then carries that same
real Bearer token. To reuse it across separate script runs instead of
re-grabbing it by hand each time, persist it with Playwright's own
`context.storageState({ path })` — it captures `localStorage` (not
`sessionStorage`), so `_meta` round-trips through it correctly.

## What to wait for after navigating

`MockAuthProvider` renders `<MCDLoader />` and blocks all children while
`isSessionChecking` is `true`, which only flips to `false` once the mount's
`validateSession()` effect resolves. Don't assert immediately after
`page.goto('/')` — wait for something that only renders once authenticated:

```ts
await expect(page.getByRole('heading', { name: /Hello/i })).toBeVisible();
```

A fixed `waitForTimeout`, or asserting on the loader itself, is both slower
and flakier than waiting on real authenticated content.

## Quick checklist

- [ ] `npx playwright install chromium` already run once — check the OS
      cache dir above before re-running.
- [ ] `_meta` (+ `app_role_selected` if a role gate matters) set via
      `addInitScript`, before `page.goto`.
- [ ] Either `/api/v1/invoke` routed to `{ success: true }` (mocked-data
      path) OR a real captured token with no route mock (real-data path) —
      not both.
- [ ] Identity-dependent checks also route-mock `useUser.ts` / the
      `menupreferences` endpoint.
- [ ] Assertions wait on real authenticated content, not a timeout or the
      loader.
