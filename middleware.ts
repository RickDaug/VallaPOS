import { NextResponse, type NextRequest } from "next/server";
import { buildCsp } from "@/lib/csp";

/**
 * CSP enforcement middleware (R-5).
 *
 * Mints a fresh per-request nonce, forwards it on a REQUEST header so the
 * server components (app/layout.tsx via `headers()`) and Next.js's own inline
 * bootstrap scripts pick it up, and sets the ENFORCED `Content-Security-Policy`
 * RESPONSE header carrying `'nonce-<value>'` for `script-src`.
 *
 * This is the canonical Next.js 15 nonce pattern:
 *   middleware mints nonce → request header (`x-nonce`) → `headers()` in the
 *   layout → passed to every inline `<script>` we render. Next.js itself reads
 *   the nonce from the CSP it sees on the request and stamps its bootstrap
 *   scripts with it automatically.
 *
 * The static security headers (HSTS, X-Frame-Options, Referrer-Policy,
 * Permissions-Policy, X-DNS-Prefetch-Control, Reporting-Endpoints) stay in
 * next.config.ts — only the CSP has to move here because the nonce is
 * per-request and can't be expressed in a static `headers()` entry.
 */
export function middleware(request: NextRequest): NextResponse {
  // 16 random bytes → base64. Web Crypto is available in the (Edge) middleware
  // runtime; no Node Buffer, no new dependency.
  const nonceBytes = crypto.getRandomValues(new Uint8Array(16));
  const nonce = btoa(String.fromCharCode(...nonceBytes));

  const csp = buildCsp(nonce, process.env.NODE_ENV === "development");

  // Forward the nonce + CSP on the REQUEST so Next.js stamps its inline
  // bootstrap scripts with this nonce and so the layout can read `x-nonce`.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  // Enforce on the RESPONSE the browser actually receives.
  response.headers.set("Content-Security-Policy", csp);
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
