import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

// Content-Security-Policy is intentionally shipped in REPORT-ONLY mode
// (`Content-Security-Policy-Report-Only`). Enforcing a strict CSP today would
// break Next.js's inline runtime bootstrap, next-themes' inline no-flash theme
// script, and the Serwist service-worker registration — all of which rely on
// inline/eval script. The enforce-mode cutover (swapping to a real
// `Content-Security-Policy` backed by per-request nonces instead of
// 'unsafe-inline'/'unsafe-eval') is tracked as a follow-up; until then this
// header only reports violations and never blocks.
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
  // Report-only on purpose — see the comment above `contentSecurityPolicy`.
  { key: "Content-Security-Policy-Report-Only", value: contentSecurityPolicy },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
