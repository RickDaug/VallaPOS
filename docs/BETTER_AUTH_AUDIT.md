# Better Auth Prisma Schema Audit

**Date:** 2026-06-13
**Author:** Automated audit (Claude Opus 4.8)
**Trigger:** STATE.md TODO — "Verify Better Auth Prisma table shape against `npx @better-auth/cli generate` once DB is live."

## Scope

Verify that the auth-owned Prisma models in `prisma/schema.prisma` (`User`, `Session`,
`Account`, `Verification`) match the shape Better Auth's Prisma adapter expects for the
**installed version `better-auth@1.2.8`** (see `package.json`), so that sign-up / sign-in /
session / email-and-password flows work without runtime errors.

Also reviewed: `src/lib/auth.ts` (server config), `src/lib/auth-client.ts` (browser client),
`src/lib/env.ts` (env validation), `src/lib/db.ts` (Prisma singleton).

## Method

**CLI generator ran successfully** (authoritative, not a documented fallback):

```
# env vars sourced from the (gitignored) .env / .env.local first, because the
# Better Auth CLI loader (jiti/c12) does NOT apply Next.js env loading and
# src/lib/auth.ts -> src/lib/env.ts throws on missing vars.
npx @better-auth/cli@1.2.8 generate --output ba-generated.prisma -y
```

The CLI version was pinned to **1.2.8** to match the installed `better-auth` dependency
(running `@latest` would have generated a 1.4.x shape and produced false positives).
The generated reference schema was diffed against the current `prisma/schema.prisma`.

The adapter's model-name and field-name resolution was also read directly from
`node_modules/better-auth/dist/...` to confirm how the Prisma client is addressed:

- Default model names are lowercase: `user`, `session`, `account`, `verification`
  (`better-auth.DORkW_Ge.mjs`).
- `getModelName()` returns `schema[model].modelName` (`better-auth.Dpv9J4ny.mjs`), and the
  Prisma adapter calls `db[model]` (`adapters/prisma-adapter/index.mjs`) — i.e. `db.user`,
  `db.session`, `db.account`, `db.verification`.
- The generated Prisma client (`.prisma/client/index.d.ts`) exposes exactly those camelCase
  delegates (`get user()`, `get session()`, `get account()`, `get verification()`), which is
  the camelCase of the PascalCase model names in our schema. **They match.**

## Result: no auth-breaking discrepancies found

The current schema is functionally compatible with `better-auth@1.2.8`. All differences are
either cosmetic, or additive hardening (extra defaults / relations / indexes / tenancy fields)
that the adapter tolerates. The build, typecheck, lint, and test suite all pass against this
schema (see Verification).

### Discrepancy table

| # | Field / model | Generated (expected) | Current schema | Severity | Effect |
|---|---|---|---|---|---|
| 1 | All 4 models | `@@map("user")` … (lowercase SQL table names) | no `@@map` (PascalCase SQL tables) | Info | None for the adapter — it addresses the Prisma **client delegate** (`db.user`), which is camelCase regardless of SQL table name. Affects only the physical table name. |
| 2 | `User.name` | `String` (required) | `String?` (optional) | Info | Current is more lenient. Email/password sign-up supplies `name`; allowing null cannot break an insert. |
| 3 | `User.emailVerified`, `*.createdAt`, `*.updatedAt` | no `@default` | `@default(false)` / `@default(now())` / `@updatedAt` | Info | Additive safety. Better Auth always supplies these values; defaults are a harmless backstop. |
| 4 | `User.email`, `Session.token` uniqueness | `@@unique([...])` (block-level) | `@unique` (field-level) | Info | Functionally identical constraint. |
| 5 | `Verification.createdAt` / `updatedAt` | `DateTime?` (nullable) | `DateTime` NOT NULL + `@default(now())` / `@updatedAt` | Low | Better Auth 1.2.8 may insert a Verification row without these timestamps. Our `@default(now())` + `@updatedAt` populate them at the Prisma layer, so inserts still succeed. No action required, but noted in case email-verification flows are exercised. |
| 6 | Extra indexes / relations | not emitted | `@@index([userId])`, `@@index([identifier])`, `Account`/`Session` relations, `User.memberships` | Info | Additive. The generator does not emit relation back-refs or secondary indexes; they are valid and beneficial (FK lookups). The adapter ignores them. |
| 7 | Tenancy fields | n/a | `Membership`, `Business`, `Role`, PIN, etc. | Info | App-owned, by design (see `src/lib/auth.ts` comment + `src/lib/tenant.ts`). Not Better Auth's concern. |

### Config review (`src/lib/auth.ts`, `src/lib/auth-client.ts`)

- `prismaAdapter(db, { provider: "postgresql" })` — correct provider; matches `datasource db`.
- `emailAndPassword.enabled: true` — requires `User.email`, `User.emailVerified`,
  `Account.password` (all present). OK.
- `session.expiresIn` / `updateAge` — require `Session.expiresAt`, `Session.updatedAt`
  (present). OK.
- `auth-client.ts` `baseURL: process.env.NEXT_PUBLIC_APP_URL` — fine on the client.
- No config changes were warranted; the config is consistent with the schema and the 1.2.8 API.

## Recommended fixes

### Non-migration fixes applied in this PR
**None.** No `auth.ts` / `auth-client.ts` change was clearly correct and necessary — the config
already matches the schema and the installed Better Auth version.

### Migration-requiring recommendations (defer / schedule — NOT applied here)

These are **optional** and **do not** fix a current bug. They would only bring the schema into
literal alignment with the generator output. Each requires a Prisma migration and is therefore
out of scope for this batch:

1. **(Optional, low priority) Add `@@map` lowercase table names** to `User`, `Session`,
   `Account`, `Verification` (`@@map("user")` etc.) to match Better Auth's convention. This is
   purely cosmetic for our Prisma-mediated access; only worth doing if a future tool or raw SQL
   path expects the documented lowercase table names. Doing it later is a table **rename**
   migration — cheaper to decide before production data exists.

If none of the above is desired, the schema can be considered verified as-is and the STATE.md
TODO closed.

## Verification

Run in the worktree with env vars sourced from `.env` / `.env.local`:

| Step | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS (11 routes compiled) |
| `npm test` (vitest) | PASS — 3 files, 23 tests |

The Better Auth CLI generator ran cleanly against `better-auth@1.2.8` and the live
`DATABASE_URL`. `.env` and `.env.local` are gitignored and were confirmed **not** staged. The
temporary `ba-generated.prisma` reference output was deleted after diffing and is not committed.
