import { configIssues } from "@/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Deployment health for the capabilities a real user notices (audit PE-4).
 *
 * The app is built to degrade rather than crash when an optional integration is
 * misconfigured — correct for a POS, but it meant a malformed STRIPE_SECRET_KEY
 * disabled BOTH revenue paths in production with no signal beyond one line in a
 * log. This endpoint turns that into something you can curl after a deploy, put
 * in a smoke test, or point an uptime check at.
 *
 * Returns 200 `{ ok: true }` when the deployment can take money and recover an
 * account; 503 with the offending variable NAMES and their user-facing impact
 * otherwise. It never returns a configuration VALUE, so it is safe to expose —
 * it reports the same capability gaps a visitor can already infer from the UI.
 */
export function GET(): Response {
  const issues = configIssues();
  return new Response(JSON.stringify({ ok: issues.length === 0, issues }, null, 2), {
    status: issues.length === 0 ? 200 : 503,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
