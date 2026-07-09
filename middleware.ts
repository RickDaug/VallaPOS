import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

/**
 * CSP middleware (R-5, report-only fallback per R4 audit #1).
 *
 * Mints a fresh per-request nonce, forwards it on a REQUEST header so the
 * server components (app/layout.tsx via `headers()`) and Next.js's own inline
 * bootstrap scripts pick it up, and sets the CSP RESPONSE header carrying
 * `'nonce-<value>'` for `script-src`.
 *
 * This is the canonical Next.js 15 nonce pattern:
 *   middleware mints nonce → request header (`x-nonce`) → `headers()` in the
 *   layout → passed to every inline `<script>` we render. Next.js itself reads
 *   the nonce from the CSP it sees on the request (it accepts BOTH the enforcing
 *   `content-security-policy` AND `content-security-policy-report-only` request
 *   headers — verified in next/dist app-render) and stamps its bootstrap scripts
 *   with it automatically. next-themes' no-flash `<script>` gets the same nonce
 *   via the `x-nonce` → ThemeProvider `nonce` prop. Serwist's SW registration is
 *   a bundled webpack entry chunk loaded by that nonce'd bootstrap, so it's
 *   covered by `'strict-dynamic'` (and the `'self'` fallback) without any inline
 *   nonce — true under BOTH report-only and enforce mode.
 *
 * ⚠ REPORT-ONLY (audit R4 #1): the enforced nonce/strict-dynamic policy could
 * white-screen the register PWA if a single directive is wrong, and it has never
 * been live-verified against a real device. Until it is, we ship the SAME policy
 * as `Content-Security-Policy-Report-Only` so violations still POST to
 * /api/csp-report (the collector) but NOTHING is blocked — a mistake can't brick
 * the till. Flip the one flag below to go live once verified.
 *
 * The static security headers (HSTS, X-Frame-Options, Referrer-Policy,
 * Permissions-Policy, X-DNS-Prefetch-Control, Reporting-Endpoints) stay in
 * next.config.ts — only the CSP has to move here because the nonce is
 * per-request and can't be expressed in a static `headers()` entry.
 */

/**
 * Set to `true` ONLY after the nonce/strict-dynamic policy has been live-verified
 * against the installed register PWA on a real device (no white screen, no
 * blocked app scripts in /api/csp-report). Until then keep it `false` so the CSP
 * is REPORT-ONLY — collecting violations without any risk of bricking the till.
 */
const CSP_ENFORCE = false;

const CSP_HEADER = CSP_ENFORCE
  ? "Content-Security-Policy"
  : "Content-Security-Policy-Report-Only";

export function middleware(request: NextRequest): NextResponse {
  // 16 random bytes → base64. Web Crypto is available in the (Edge) middleware
  // runtime; no Node Buffer, no new dependency.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  // Forward the nonce + CSP on the REQUEST so Next.js stamps its inline
  // bootstrap scripts with this nonce and so the layout can read `x-nonce`.
  // We forward under the SAME header name we emit (enforce vs report-only); Next
  // reads the nonce from either, so its bootstrap scripts are nonce'd in both
  // modes — meaning report-only produces zero self-inflicted violations and an
  // eventual flip to enforce is seamless.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set(CSP_HEADER, csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Send on the RESPONSE the browser actually receives — enforcing OR report-only
  // depending on CSP_ENFORCE above.
  response.headers.set(CSP_HEADER, csp);
  return response;
}

export const config = {
  // Run on real document/RSC requests only. Skip Next internals, the generated
  // service worker, the manifest, and static asset files (all served from
  // 'self' and not in need of a per-request nonce) so we don't pay the cost or
  // accidentally attach a CSP to the precached SW.
  matcher: [
    {
      source:
        "/((?!_next/static|_next/image|favicon.ico|sw.js|swe-worker-.*\\.js|manifest.webmanifest|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$).*)",
      missing: [
        // Don't run on Next's internal data prefetches that already carry these.
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
