import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

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
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // refresh daily
  },
});

export type Session = typeof auth.$Infer.Session;
