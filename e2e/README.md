# E2E smoke tests (Playwright)

The first end-to-end coverage for VallaPOS. These drive a **real browser** against a
**running app + live database**, so they are deliberately kept out of the unit suite:

- `npm test` → Vitest only (unit/integration, no browser). It does **not** pick up `e2e/`.
- `npm run test:e2e` → Playwright (this directory).

## What it covers

`smoke.spec.ts`:

1. **Critical path** — sign in as the seeded owner, bootstrap past the operator
   lock, ring up the seeded **Classic Burger** (choosing its required "Cook"
   modifier), tender **cash** ("Exact"), complete the sale, and assert the
   success/receipt state (`Order #N`, **change due**, **New sale**).
2. **Auth guard (lighter)** — the sign-in page renders and a bad password is
   rejected with a generic `role="alert"` error while staying on `/sign-in`.

Selectors use roles / accessible names / visible text (not brittle CSS).

## Prerequisites

1. **A database with the demo data seeded.** From the repo root:
   ```sh
   npm run db:seed
   ```
   This creates the test login `owner@valla.test` / `supersecret123` plus the
   demo catalog (Classic Burger + modifiers, Soda, Line Up) the spec relies on.

2. **A running app.** Either start it locally:
   ```sh
   npm run dev          # serves http://localhost:3000 (the default base URL)
   ```
   …or point the tests at a deployed instance via `E2E_BASE_URL` (below).
   (The Playwright config intentionally does **not** start the server for you —
   it can't provision the Postgres + seeded login the app needs.)

3. **The Chromium browser binary** (one-time, per machine):
   ```sh
   npx playwright install chromium
   ```

## Running

```sh
npm run test:e2e
```

Against a deployed environment instead of localhost:

```sh
E2E_BASE_URL=https://valla-pos.vercel.app npm run test:e2e
```

Useful flags (pass through to `playwright test`):

```sh
npm run test:e2e -- --headed          # watch the browser
npm run test:e2e -- --ui              # interactive UI mode
npm run test:e2e -- smoke.spec.ts -g "bad password"   # one test
```

## Artifacts

All gitignored:

- HTML report → `.playwright/report/` (open with `npx playwright show-report .playwright/report`)
- Traces / screenshots / videos (on failure) → `test-results/`

## Notes

- The seeded owner has **no PIN**, so the spec clicks **"Continue as Demo Owner"**
  on the operator-lock screen. A staff member with a PIN would get a PIN pad
  instead — not exercised by the smoke path.
- After a completed sale the register re-locks the terminal (operator model), so
  re-running the suite always starts fresh from the lock screen — that's expected.
