import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
