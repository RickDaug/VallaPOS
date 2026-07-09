/**
 * Content-Security-Policy builder (R-5 — nonce-based).
 *
 * NOTE: the SAME policy string this builds is shipped either as the enforcing
 * `Content-Security-Policy` header or, until the policy is live-verified against
 * the register PWA, as `Content-Security-Policy-Report-Only` — that choice is
 * made by the `CSP_ENFORCE` flag in middleware.ts (audit R4 #1). This builder is
 * mode-agnostic: it only produces the directive string.
 *
 * This is the single source of truth for the CSP directives. It lives in a
 * pure, dependency-free module so it can be unit-tested without pulling in
 * `next/server`, and so both the middleware (which mints a per-request nonce)
 * and the tests share exactly one policy definition.
 *
 * Why a per-request nonce instead of `'unsafe-inline'` on scripts:
 *   The whole point of enforcing CSP is to neutralise injected inline scripts
 *   (XSS). `'unsafe-inline'` on `script-src` would defeat that. Instead every
 *   request gets a fresh random nonce; the only inline scripts allowed are the
 *   ones WE render with `nonce={nonce}` (Next.js's own bootstrap + next-themes'
 *   no-flash theme script). Anything an attacker injects has no matching nonce
 *   and is blocked.
 *
 * `'strict-dynamic'`:
 *   Next.js's nonce'd bootstrap script programmatically loads the rest of the
 *   app's chunks. `'strict-dynamic'` propagates trust from a nonce'd script to
 *   the scripts it loads, so we don't have to allowlist every chunk URL. In
 *   browsers that honour it, the `'self'`/host fallbacks below are ignored for
 *   scripts; we keep them for older browsers that don't support strict-dynamic.
 *
 * Styles stay `'unsafe-inline'` (a deliberate, documented tradeoff):
 *   Nonces do not apply to inline STYLE ATTRIBUTES (`style={{…}}`), only to
 *   `<style>` elements. The floor-plan editor positions tables with inline
 *   `style` (x/y/w/h), and Next/Tailwind inject inline styles too, so a
 *   nonce-only style policy would break rendering. Inline-style injection is a
 *   far weaker vector than script injection (no JS execution), so we accept
 *   `'unsafe-inline'` for `style-src` while keeping `script-src` strict. This
 *   is the same tradeoff the Next.js CSP guide documents.
 */

// Same-origin endpoint that collects CSP violations (see app/api/csp-report).
// Kept from #59 so violations still report under enforce mode.
export const CSP_REPORT_PATH = "/api/csp-report";
// Reporting API group name; paired with the `Reporting-Endpoints` response
// header set in next.config.ts.
export const REPORT_TO_GROUP = "csp-endpoint";

/**
 * Build the enforced Content-Security-Policy string for one request.
 *
 * @param nonce         base64 per-request nonce (without the `'nonce-'` wrapper)
 * @param isDev         when true, relax `script-src` with `'unsafe-eval'` so the
 *                      Next.js dev server's HMR/eval-based tooling works. The SW
 *                      and a real enforced CSP only matter in production builds,
 *                      but middleware runs in dev too, so we must not brick `next dev`.
 */
export function buildCsp(nonce: string, isDev: boolean): string {
  const scriptSrc = [
    "script-src",
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    // Dev-only: Next's HMR / React refresh use eval. Never emitted in prod.
    ...(isDev ? ["'unsafe-eval'"] : []),
  ].join(" ");

  return [
    "default-src 'self'",
    scriptSrc,
    // See the module doc: inline style attributes can't be nonce'd, so styles
    // stay 'unsafe-inline'. Scripts do NOT — that's where the protection is.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    // The browser only ever talks back to its OWN origin: Better Auth is
    // same-origin, all data mutations go through same-origin server actions /
    // route handlers, and the offline queue re-POSTs to same-origin routes. The
    // external services (Neon / Upstash / Stripe's REST API) are called ONLY
    // server-side (Stripe.js is not loaded in the client; there are no WebSocket
    // or analytics beacons), so they never appear as a browser `connect` target.
    // Hence `'self'` — not the blanket `https:` — is the correct, tight policy.
    // If a client-side external call is ever added (e.g. Stripe.js →
    // js.stripe.com / api.stripe.com), allowlist those exact origins here.
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Keep violation reporting (legacy report-uri + standards-track report-to).
    `report-uri ${CSP_REPORT_PATH}`,
    `report-to ${REPORT_TO_GROUP}`,
  ].join("; ");
}
