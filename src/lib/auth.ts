import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSecondaryStorage } from "@/lib/redis";

// When Upstash is configured, Better Auth uses Redis as a SHARED, persistent
// store for the rate limiter (otherwise it's per-instance in-memory and resets
// on every Vercel cold start — the H-3 audit finding). We keep the DB as the
// session source of truth (storeSessionInDatabase) so turning Redis on only adds
// the shared limiter + a session cache; it does not change session durability.
const secondaryStorage = createSecondaryStorage();

/**
 * Better Auth server config (scaffold).
 *
 * Database sessions (stored in our Postgres) so a cashier can be revoked
 * instantly and logins are auditable. Multi-tenant business membership + roles
 * are modeled in our own schema (Business/Membership) and enforced via
 * src/lib/tenant.ts — the Organization plugin can be layered on later if we
 * want Better Auth to manage invitations/teams directly.
 */
export const auth = betterAuth({
  database: prismaAdapter(db, { provider: "postgresql" }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  // Pin the allowed origin set explicitly instead of relying on the implicit
  // baseURL-derived default.
  trustedOrigins: [env.BETTER_AUTH_URL],
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
    ...(secondaryStorage ? { storeSessionInDatabase: true } : {}),
  },
  ...(secondaryStorage
    ? { secondaryStorage, rateLimit: { storage: "secondary-storage" as const } }
    : {}),
});

export type Session = typeof auth.$Infer.Session;
