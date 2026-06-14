import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// tsx doesn't auto-load env files. Pull DATABASE_URL (for Prisma) plus the
// BETTER_AUTH_* / NEXT_PUBLIC_* vars (validated by src/lib/env.ts when we
// dynamically import the auth instance) from .env / .env.local — same loader
// as seed.ts.
for (const file of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z0-9_]+$/.test(key) || process.env[key] !== undefined) continue;
      process.env[key] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    // file is optional
  }
}

const db = new PrismaClient();

// A dedicated throwaway identity — never a real or demo login. Deleted before
// and after the run so this is idempotent and leaves no residue.
const EMAIL = "auth-smoke@valla.test";
const PASSWORD = "smoke-pw-9f3k2x";

/**
 * Auth smoke test: exercises the real risk surface of a Better Auth version
 * bump end-to-end against the live DB — sign-up (password hashing + User/Account
 * adapter writes) and sign-in (credential check + Session creation) — then
 * cleans up. Run after any `better-auth` upgrade: `npx tsx prisma/smoke-auth.ts`.
 */
async function cleanup() {
  await db.user.deleteMany({ where: { email: EMAIL } }); // cascade clears Session/Account
}

async function main() {
  await cleanup(); // start clean in case a prior run aborted mid-way

  const { auth } = await import("../src/lib/auth");

  // 1) Sign-up: Better Auth hashes the password and writes User + Account.
  const signUp = await auth.api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: "Auth Smoke" },
  });
  if (!signUp?.user?.id) throw new Error("signUpEmail did not return a user id");
  const userId = signUp.user.id;

  const account = await db.account.findFirst({ where: { userId, providerId: "credential" } });
  if (!account?.password) throw new Error("no credential Account row with a hashed password");
  if (account.password === PASSWORD) throw new Error("password stored in plaintext (!)");

  // 2) Sign-in: verifies the hashed credential and mints a session.
  const signIn = await auth.api.signInEmail({ body: { email: EMAIL, password: PASSWORD } });
  if (!signIn?.user || signIn.user.id !== userId)
    throw new Error("signInEmail did not return the expected user");

  const sessions = await db.session.count({ where: { userId } });
  if (sessions < 1) throw new Error("sign-in did not create a Session row");

  // 3) Negative check: a wrong password must be rejected.
  let rejected = false;
  try {
    await auth.api.signInEmail({ body: { email: EMAIL, password: "wrong-password" } });
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("sign-in accepted a wrong password (!)");

  console.log(
    `PASS: sign-up + hashed credential + sign-in (${sessions} session) + wrong-password rejected`,
  );
}

main()
  .then(cleanup)
  .then(async () => {
    await db.$disconnect();
  })
  .catch(async (err) => {
    await cleanup().catch(() => {});
    await db.$disconnect();
    console.error("FAIL:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
