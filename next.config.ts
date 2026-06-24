import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// Content-Security-Policy is intentionally shipped in REPORT-ONLY mode
// (`Content-Security-Policy-Report-Only`). Enforcing a strict CSP today would
// break Next.js's inline runtime bootstrap, next-themes' inline no-flash theme
// script, and the Serwist service-worker registration — all of which rely on
// inline/eval script. The enforce-mode cutover (swapping to a real
// `Content-Security-Policy` backed by per-request nonces instead of
// 'unsafe-inline'/'unsafe-eval') is tracked as a follow-up; until then this
// header only reports violations and never blocks. As of R-5 the policy now
// carries `report-uri`/`report-to` pointing at `/api/csp-report` so we actually
// collect violations BEFORE attempting that enforce flip.
// Same-origin endpoint that collects CSP violations (R-5). Wired below via the
// legacy `report-uri` directive AND the modern Reporting API (`report-to` +
// `Reporting-Endpoints`), so violations are captured in both old and new
// browsers. The endpoint only logs/no-ops; it does NOT enforce anything.
const CSP_REPORT_PATH = "/api/csp-report";
// Reporting API group name; referenced by both `report-to` and `Reporting-Endpoints`.
const REPORT_TO_GROUP = "csp-endpoint";

const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
  // Collect violations. `report-uri` is the widely-supported legacy directive;
  // `report-to` is the standards-track replacement (paired with the
  // `Reporting-Endpoints` header below). We ship both for coverage.
  `report-uri ${CSP_REPORT_PATH}`,
  `report-to ${REPORT_TO_GROUP}`,
].join("; ");

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
  // Modern Reporting API endpoint map for the `report-to` directive above.
  { key: "Reporting-Endpoints", value: `${REPORT_TO_GROUP}="${CSP_REPORT_PATH}"` },
  // Report-only on purpose — see the comment above `contentSecurityPolicy`.
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
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
