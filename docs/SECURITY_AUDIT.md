# VallaPOS — Security Audit

**Date:** 2026-06-14
**Auditor:** Automated read-only audit (Claude Opus 4.8)
**Scope:** Full application security review of the multi-tenant browser POS. READ-ONLY — no application code was changed; this document is the only file added.
**Commit basis:** `main` (worktree off `main`). `npm audit` = **0 vulnerabilities** at time of audit.
**Stack:** Next.js 15.5.19 (App Router) · Better Auth 1.6.18 (email+password, DB sessions, Prisma adapter) · Prisma 6.9 + Neon Postgres · Vercel · Serwist PWA + IndexedDB offline queue.

---

## Executive summary

VallaPOS is, for an MVP, **unusually disciplined on the two things that matter most for a multi-tenant money app: tenant isolation and money authority.** Every tenant-owned query and mutation I inspected routes through `requireMembership(businessId)` and carries an explicit `where: { businessId }`; role gates (`assertRole`) are present and correct on refunds, voids, catalog writes, settings, drawer close, and employee management; the checkout action is fully server-authoritative (it re-looks-up every price/modifier from the DB and never trusts client totals) and is idempotent on `clientUuid`. PINs are scrypt-salted with constant-time verify, card data is brand/last4 only (no PAN), and Prisma keeps all queries parameterized. No `dangerouslySetInnerHTML`, no raw SQL, no secrets in request-path logs, `.env*` gitignored, deps pinned, `npm audit` clean.

The findings are therefore **not** about broken isolation — they are about **missing edge hardening** that a production POS should have before real customer traffic:

- **No HTTP security headers / CSP at all** (next.config.ts has no `headers()` block, no middleware). This is the single biggest gap — clickjacking, MIME-sniffing, no CSP defense-in-depth against XSS.
- **CSV formula injection** in the reports export — a malicious item/customer name like `=cmd|...` is written verbatim into the export CSV and executes when opened in Excel/Sheets.
- **Account enumeration on sign-up** — Better Auth returns "User already exists" and the UI surfaces it verbatim, so an attacker can probe which emails have accounts.
- **Rate-limiter storage is in-memory** on a serverless host — Better Auth's brute-force throttle is enabled in prod but, with the default `memory` store on Vercel, is per-instance and resets on cold start, so it's far weaker than it looks.
- **The architecture's own recommended Prisma `$extends` tenant backstop is absent** — isolation rests entirely on human discipline at every call site. It holds today (I verified every call site), but there is no machine guardrail against the next forgotten filter.

None are Critical (no live cross-tenant leak, no auth bypass, no money-integrity hole was found). The top items are **High**: headers/CSP, CSV injection, and the rate-limit storage gap.

### What's already solid (verified, not assumed)

- **Tenant isolation:** every `queries.ts`/`actions.ts` and both route handlers scope by `businessId` and go through `requireMembership`. IDOR is blocked — `getOrderReceipt` uses `findFirst({ where: { id, businessId } })` (not `findUnique` on id alone); catalog/employee/drawer mutations use `updateMany`/`deleteMany` scoped by `businessId`, so a forged id from another tenant updates 0 rows. (`src/features/orders/queries.ts:234`, `src/features/catalog/actions.ts:157`, `src/features/employees/actions.ts:97`.)
- **Role gating:** refunds/voids/`closeDrawer` → MANAGER; catalog writes → MANAGER; settings → OWNER; employee admin → MANAGER; last-OWNER demotion/deactivation guarded. (`src/features/orders/actions.ts:113,151`, `src/features/settings/actions.ts:22`, `src/features/employees/actions.ts:90`.)
- **Money authority:** checkout recomputes all totals server-side from DB prices + business tax, validates modifier min/max, re-resolves modifiers DB-side, idempotent on `clientUuid`. (`src/features/register/actions.ts:32-216`.)
- **Cookies:** Better Auth defaults give `httpOnly: true`, `sameSite: "lax"`, and `secure: true` whenever `BETTER_AUTH_URL` is `https://` (it is, in prod) — correct without extra config.
- **CSRF:** server actions are origin-checked by Next; auth goes through Better Auth's `originCheck` (the 1.6.18 bump fixed the open-redirect there). No state-changing GET route handlers (the only GET handler, the CSV export, is read-only).
- **Sign-in enumeration:** sign-in correctly returns the generic `INVALID_EMAIL_OR_PASSWORD`.
- **Injection/XSS:** Prisma parameterized throughout; **zero** `dangerouslySetInnerHTML`, `$queryRaw`, or `$executeRaw`.
- **PII/payments:** `Membership.pinHash` only (scrypt salted, constant-time verify, hash never selected/returned — only a `hasPin` boolean); card fields are `cardBrand`/`cardLast4` only with a "never PAN/expiry" schema comment; `customerName` optional.
- **Secrets:** `src/lib/env.ts` zod-validates 4 vars and fails fast; only `NEXT_PUBLIC_APP_URL` is public (a URL, not a secret); no secret logging in any request path; `.env`/`.env.local` gitignored; only `prisma generate` postinstall; lockfile committed, all deps pinned exact.

### What I could NOT fully verify

- **Runtime header behavior** — verified by static inspection (no `headers()`/middleware exists), not by hitting a live deploy. A Vercel-level header config could in theory exist outside the repo; I saw none.
- **Source maps in prod** — `next.config.ts` does not set `productionBrowserSourceMaps`, so the Next default (no browser source maps in prod) applies. Not confirmed against a live bundle.
- **Better Auth rate-limit live behavior on Vercel** — the in-memory/per-instance weakness is inferred from the library source (`storage: "memory"` default) + serverless model; not load-tested against the deploy.
- **Service-worker cache contents** — `public/sw.js` is generated/gitignored; I reviewed `app/sw.ts` source and `defaultCache` semantics, not the emitted runtime cache of a real session.

---

## Findings (ordered by severity)

| ID | Severity | Area | Finding | Location (file:line) | Recommendation |
|----|----------|------|---------|----------------------|----------------|
| H-1 | **High** | HTTP headers / CSP | No security headers at all. `next.config.ts` has no `headers()` block and there is no `middleware.ts`. Missing: CSP, HSTS, X-Frame-Options/`frame-ancestors`, X-Content-Type-Options, Referrer-Policy, Permissions-Policy. App is clickjackable and has no CSP defense-in-depth against XSS. | `next.config.ts:1-20` (no `headers()`); no `middleware.ts` in repo | Add an async `headers()` to `next.config.ts` (concrete block below). At minimum set `X-Frame-Options: DENY` (or CSP `frame-ancestors 'none'`), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security`, `Permissions-Policy`, and a `Content-Security-Policy` (start report-only). Note: a strict CSP needs care with Next inline/runtime scripts + Serwist; roll out `Content-Security-Policy-Report-Only` first. |
| H-2 | **High** | Injection (CSV) | CSV formula injection in the report export. `csvField` only quotes cells containing `,"`/CR/LF; it does NOT neutralize a leading `= + - @` (or tab/CR). A malicious item name, modifier name, category, or customer name (all user-controlled, stored as `nameSnapshot`/`name`) is emitted verbatim; opening the CSV in Excel/Sheets executes `=...` as a formula (data exfiltration / command via DDE). | `src/features/orders/report-aggregate.ts:86-89` (`csvField`); reaches output via `buildReportCsv` rows `i.name`/`c.category` lines 134,137; served by `app/(app)/[businessId]/reports/export/route.ts:45-66` | In `csvField`, if `String(value)` starts with `= + - @`, tab (`\t`), or CR (`\r`), prefix it with a single quote `'` before applying the existing RFC-4180 quoting. e.g. `if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;`. Keep the current comma/quote/newline escaping. |
| H-3 | **High** | Rate limiting / brute force | Better Auth's rate limiter is enabled by default in production (`enabled: isProduction`, sign-in/up special rule = 3 req / 10s), but `auth.ts` configures **no `secondaryStorage`**, so the limiter uses the default **in-memory `Map`**. On Vercel's multi-instance serverless this is per-instance and lost on cold start — the throttle is far weaker than 3/10s across the fleet, and absent during scale-out. | `src/lib/auth.ts:15-26` (no `rateLimit`/`secondaryStorage`); Better Auth default `storage: "memory"` (`node_modules/better-auth/dist/context/create-context.mjs:163-168`), special rules (`.../api/rate-limiter/index.mjs:371-385`) | Configure a shared rate-limit store: set `secondaryStorage` (Redis/Upstash) so the limiter is fleet-wide, or move the limiter behind a shared store. At minimum, document the limitation and consider Vercel WAF / platform rate limiting on `/api/auth/*`. Explicitly set `rateLimit: { enabled: true, window, max }` so dev/preview are covered too. |
| M-1 | **Med** | Tenant isolation (defense-in-depth) | The architecture's own recommended **Prisma `$extends` tenant backstop** (ARCHITECTURE.md §3/§10 — "throws in dev if a tenant model is queried without `businessId`") is **not implemented**. Isolation today rests entirely on every developer remembering `where: { businessId }`. I verified all current call sites are correct, but there is no machine guardrail against the next one. | `src/lib/db.ts` (plain singleton, no `$extends`); gap vs `docs/ARCHITECTURE.md:66,101` | Add a Prisma client extension that asserts a `businessId` (or explicit opt-out) is present in `where`/`data` for tenant-owned models, throwing in dev/test. Even a test-only guard (a lint/CI check that every tenant-model `findMany`/`updateMany` includes `businessId`) closes most of the risk. |
| M-2 | **Med** | AuthN (enumeration) | Account enumeration on **sign-up**. Better Auth returns `USER_ALREADY_EXISTS` ("User already exists") for a taken email, and `sign-up/page.tsx` surfaces `signUp.error.message` verbatim. An attacker can enumerate which emails have accounts. (Sign-in is fine — generic `INVALID_EMAIL_OR_PASSWORD`.) | `app/(auth)/sign-up/page.tsx:28-30`; Better Auth `USER_ALREADY_EXISTS` | Lower-risk for a B2B POS (operators, not public consumers), but to fix: present a neutral "If that email is available, your account was created / check your email" flow, or map `USER_ALREADY_EXISTS` to a generic message and rely on an email-verification step to disambiguate. Consider enabling email verification (see M-3). |
| M-3 | **Med** | AuthN (email verification) | Email verification is **not required**. `auth.ts` sets `emailAndPassword.enabled: true` with no `requireEmailVerification` and no email provider wired. Anyone can sign up with an unowned/typo'd email and immediately create a business; no proof-of-control of the address. | `src/lib/auth.ts:19-21` (no `requireEmailVerification`) | Decide the posture deliberately. For a paid POS, require email verification before first business creation (needs the parked email provider — Resend scaffold exists). At minimum document that addresses are unverified (affects receipt-email trust + enumeration). |
| M-4 | **Med** | PWA / offline (data-at-rest) | The IndexedDB offline checkout queue persists full order payloads (line items, `customerName`, cash tendered, discounts) on-device and is **never cleared on sign-out**. `SignOutButton` only calls `authClient.signOut()`. On a shared/borrowed device, a subsequent user (or anyone with the device) can read un-synced sales from `vallapos-offline`. | `src/components/SignOutButton.tsx:11-13` (no queue clear); `src/lib/offline/checkout-queue.ts` (persists `CheckoutInput`) | On sign-out, after the queue is confirmed drained (or with an explicit "discard N unsynced sales?" prompt), delete the `vallapos-offline` DB (`indexedDB.deleteDatabase` / clear the store). Be careful not to silently drop un-synced sales — prefer "sync then clear", warn if pending. |
| M-5 | **Med** | PWA / service worker caching | The service worker uses `...defaultCache` (network-first for navigations, SWR for RSC/data) for everything that isn't a POST/`/api/`. Authenticated POS shells/pages can land in the SW cache, so on a shared device a signed-out/different user could be served a cached authed view before the network revalidates. Money POSTs are correctly `NetworkOnly`. | `app/sw.ts:21-36` (`defaultCache` for pages/data) | Acceptable for offline UX but worth tightening on shared devices: avoid caching responses for authed RSC/data routes, or scope/clear the runtime cache on sign-out. At minimum confirm no sensitive page bodies persist after sign-out during the M-4 cleanup. |
| L-1 | **Low** | Info disclosure (errors) | Server actions throw raw `Error("...")` (e.g. `"Item not found."`, `"Cash tendered is less than the total."`, `Unknown item: <id>`). In React Server Actions, prod strips messages to a generic digest for the client, but dev/preview surface the raw message, and the sign-in/up pages render `err.message` directly. Low risk (messages are not secrets) but a few echo ids. | e.g. `src/features/register/actions.ts:81,98,146`; `app/(auth)/sign-in/page.tsx:33` | Keep throwing for truly exceptional cases, but prefer the existing typed-result pattern (`{ ok: false, reason }`, already used by refunds/`emailReceipt`) for expected failures so nothing is echoed. Don't include raw ids in messages. |
| L-2 | **Low** | DoS (unbounded reads) | Several tenant-scoped `findMany` calls have no `take` cap: `getManagedCatalog` (items/categories/modifiers), `listMembers`, `getTimesheet`, `getDailyReport`/`getItemSalesReport` (date-windowed). All are tenant-bounded so blast radius is one business, but a business with a huge catalog/timesheet could OOM a render. | `src/features/catalog/queries.ts:42,137,144,161`; `src/features/employees/queries.ts:26,87`; `src/features/orders/queries.ts:81,95,148` | Add sane `take` bounds + pagination on the management/report reads, or cap by date window. `listOrders` already does this (`take: 100`). |
| I-1 | **Info** | Dependencies | `npm audit` = 0. Deps pinned exact, lockfile committed, only `postinstall: prisma generate` (safe). `overrides.postcss` 8.5.15 dedupes the patched postcss. | `package.json:24-60` | None. Maintain the pin-and-audit discipline; re-run `npm audit` on each dep bump. |
| I-2 | **Info** | Auth schema cosmetics | Better Auth tables lack lowercase `@@map` (cosmetic; adapter addresses the camelCase Prisma delegate). Already tracked in `docs/BETTER_AUTH_AUDIT.md`. | `prisma/schema.prisma` (User/Session/Account/Verification) | Optional table-rename migration; decide before production data grows. No security impact. |

---

## Concrete recommendation for H-1 (security headers)

Add to `next.config.ts` (wrap the existing config; Serwist still wraps the result). Start CSP in **report-only** mode and watch for violations from Next's inline runtime + Serwist before enforcing.

```ts
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Begin report-only; promote to Content-Security-Policy once clean.
  {
    key: "Content-Security-Policy-Report-Only",
    value: [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "img-src 'self' data: blob:",
      "object-src 'none'",
      // Next/Serwist need care here — tune script/style before enforcing.
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};
```

## Concrete recommendation for H-2 (CSV injection)

In `src/features/orders/report-aggregate.ts`, harden `csvField`:

```ts
export function csvField(value: string | number): string {
  let s = String(value);
  // Neutralize spreadsheet formula injection: a cell that a spreadsheet would
  // evaluate (leading = + - @, tab, or CR) is prefixed with a single quote.
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
```

This preserves the RFC-4180 escaping and only adds the leading-quote guard for risky cells.

---

## Prioritized fix order

1. **H-1 headers/CSP** — cheapest high-value win; one config block (CSP report-only first).
2. **H-2 CSV injection** — one-function fix with an obvious test (`=1+1` in an item name → `'=1+1` in export).
3. **H-3 rate-limit storage** — needs an infra decision (shared store / WAF); document the gap meanwhile.
4. **M-1 Prisma `$extends` backstop** — institutionalizes the isolation invariant; at minimum a CI/lint guard.
5. **M-2/M-3 enumeration + email verification** — decide auth posture together.
6. **M-4/M-5 offline data-at-rest + SW cache on shared devices** — clear `vallapos-offline` on sign-out (sync-then-clear).
7. **L-1/L-2** — typed-result errors + `take` bounds as cleanup.
