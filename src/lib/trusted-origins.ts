/**
 * The origin allow-list Better Auth will accept requests from.
 *
 * Split out of auth.ts (which imports `@/lib/env`, and env.ts throws when the
 * required vars are absent — i.e. under vitest) so the rules are unit-testable.
 *
 * WHY THE PREVIEW BRANCH EXISTS: `trustedOrigins` was a fixed list — the two
 * configured URLs plus the custom domain — so signing in on a Vercel PREVIEW
 * deployment always failed with "Invalid origin": previews are served from a
 * per-branch `valla-pos-git-<branch>-<team>.vercel.app` host that is in none of
 * them. That left auth changes with NO way to be verified before production,
 * which is the worst place to first exercise a sign-in change.
 *
 * Vercel injects VERCEL_BRANCH_URL / VERCEL_URL (host only, no scheme) on every
 * deployment, so we trust those on NON-production deployments only. Production's
 * allow-list is byte-for-byte unchanged, and previews already sit behind Vercel
 * deployment protection, so this grants nothing to anyone who couldn't already
 * reach the deployment.
 */
export function buildTrustedOrigins(input: {
  betterAuthUrl?: string;
  appUrl?: string;
  vercelEnv?: string;
  vercelBranchUrl?: string;
  vercelUrl?: string;
}): string[] {
  const origins: (string | undefined)[] = [
    input.betterAuthUrl,
    input.appUrl,
    "https://vallapos.com",
    "https://www.vallapos.com",
  ];

  // Preview/development only — NEVER widen production's allow-list.
  if (input.vercelEnv !== "production") {
    for (const host of [input.vercelBranchUrl, input.vercelUrl]) {
      // Vercel supplies a bare host; a value that already has a scheme is passed
      // through rather than turned into "https://https://…".
      if (host) origins.push(host.startsWith("http") ? host : `https://${host}`);
    }
  }

  return Array.from(new Set(origins.filter((o): o is string => Boolean(o))));
}
