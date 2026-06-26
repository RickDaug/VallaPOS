import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// The Content-Security-Policy itself is now ENFORCED (R-5) and lives in
// `middleware.ts`, because it carries a fresh per-request `'nonce-<value>'` for
// `script-src` and a static `headers()` entry can't be per-request. The only
// CSP-adjacent piece that stays here is the modern Reporting API endpoint map
// (`Reporting-Endpoints`), referenced by the `report-to` directive the
// middleware emits, alongside all the other static security headers.
//
// Same-origin endpoint that collects CSP violations (kept from #59 so
// violations still report under enforce mode). Wired in `src/lib/csp.ts` via the
// legacy `report-uri` directive AND the modern Reporting API (`report-to` +
// `Reporting-Endpoints` below), so violations are captured in old and new
// browsers. The endpoint only logs/no-ops; it does NOT enforce anything.
const CSP_REPORT_PATH = "/api/csp-report";
// Reporting API group name; referenced by both `report-to` and `Reporting-Endpoints`.
// Kept in sync with REPORT_TO_GROUP in src/lib/csp.ts.
const REPORT_TO_GROUP = "csp-endpoint";

const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "X-DNS-Prefetch-Control", value: "on" },
  // Modern Reporting API endpoint map for the `report-to` directive the
  // middleware emits in the enforced Content-Security-Policy.
  { key: "Reporting-Endpoints", value: `${REPORT_TO_GROUP}="${CSP_REPORT_PATH}"` },
  // NOTE: the Content-Security-Policy header is ENFORCED and set per-request in
  // middleware.ts (nonce-based) — it is intentionally NOT listed here.
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Don't advertise the framework via X-Powered-By.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Serwist (the next-pwa successor) generates the service worker from `app/sw.ts`
// into `public/sw.js`. Disabled in dev so HMR isn't fighting a cached shell —
// the SW only registers in production builds (Serwist convention).
const withSerwist = withSerwistInit({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // Reload any open tab as soon as a new SW takes control, so a deploy doesn't
  // leave a cashier on a stale shell.
  reloadOnOnline: true,
});

export default withSerwist(nextConfig);
