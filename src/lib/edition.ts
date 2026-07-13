/**
 * EDITION — the one build-time switch that splits VallaPOS into two builds from
 * a single codebase (see docs/EDITIONS.md). NOT a fork.
 *
 *   - "cloud" (default): the hosted app at vallapos.com — Neon/Prisma, Better
 *     Auth sessions, Stripe payments + subscription, multi-tenant.
 *   - "local": the downloadable Tauri desktop app sold once on vallahub.com —
 *     cash-only, single-tenant, offline, local SQLite, local-PIN auth, thermal
 *     receipts, unlocked by a one-time signed license key.
 *
 * This module is a PURE, direct `process.env` read (NOT `@/lib/env`) so it stays
 * import-safe and unit-testable everywhere — mirroring the flag convention in
 * `src/features/payments/flags.ts` and `src/features/peripherals/flags.ts`.
 *
 * INERT until wired: nothing imports this yet, and `EDITION` defaults to "cloud",
 * so the hosted build behaves exactly as before unless a build sets
 * NEXT_PUBLIC_VALLA_EDITION=local. The `NEXT_PUBLIC_` prefix is required because
 * both the server layer and the client shell must read it (same reason the
 * Stripe publishable key is public).
 */

export type Edition = "cloud" | "local";

export const EDITION: Edition =
  process.env.NEXT_PUBLIC_VALLA_EDITION === "local" ? "local" : "cloud";

export const isLocal = EDITION === "local";
export const isCloud = EDITION === "cloud";

/** Auth model: cloud uses Better Auth sessions; local uses an on-device PIN. */
export const authMode: "session" | "pin-only" = isLocal ? "pin-only" : "session";

/** Persistence engine behind the (future) DataStore seam. */
export const dataSource: "neon" | "sqlite" = isLocal ? "sqlite" : "neon";

/** Only the cloud edition scopes data by businessId; local is single-tenant. */
export const isMultiTenant = isCloud;

/** Local is CASH-ONLY — Stripe/QR/card tenders are compiled off. */
export const paymentsEnabled = isCloud;

/** Local drives the thermal printer + cash drawer as a first-class path. */
export const peripheralsEnabled = isLocal;

/** Local has no Better Auth / Upstash session store. */
export const usesCloudSession = isCloud;

/** Local is unlocked by a one-time signed license key, not a subscription. */
export const requiresLicenseKey = isLocal;
