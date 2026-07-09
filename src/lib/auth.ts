import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { createSecondaryStorage } from "@/lib/redis";
import { sendPasswordResetEmail } from "@/lib/auth-emails";

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
  // Allow every origin the app is actually served from. It's reachable on the
  // custom domain AND the *.vercel.app domain, so a single pinned origin made
  // sign-in fail CSRF/CORS on whichever domain didn't match (the auth client
  // now fetches same-origin — see auth-client.ts). Deduped, falsy dropped.
  trustedOrigins: Array.from(
    new Set(
      [
        env.BETTER_AUTH_URL,
        env.NEXT_PUBLIC_APP_URL,
        "https://vallapos.com",
        "https://www.vallapos.com",
      ].filter(Boolean),
    ),
  ),
  emailAndPassword: {
    enabled: true,
    // Self-serve password reset (audit R4 #2 — the day-7 lockout fix). Better
    // Auth mints the reset token + verification URL; we just deliver it via the
    // already-configured Resend transport. The URL routes through Better Auth's
    // GET /api/auth/reset-password/:token, which validates the token and then
    // redirects the browser to our `/reset-password?token=…` page. When Resend
    // isn't configured this degrades to a logged link (see auth-emails.ts) so a
    // reset never hard-fails — it mirrors the receipt-email optional-env pattern.
    sendResetPassword: async ({ user, url }) => {
      await sendPasswordResetEmail(user.email, url);
    },
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
