"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Better Auth browser client. Use in client components for sign-in/out hooks.
 *
 * baseURL is the CURRENT page origin, not a hardcoded `NEXT_PUBLIC_APP_URL`, so
 * auth fetches are ALWAYS same-origin. The app is reachable on both the custom
 * domain (`vallapos.com`) and the `*.vercel.app` domain; pinning the base to one
 * of them made sign-in fail with a cross-origin CORS error ("Failed to fetch")
 * on the other. Falls back to the configured URL during SSR/build where
 * `window` is undefined. (Server-side `trustedOrigins` must include both
 * domains too — see auth.ts.)
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== "undefined" ? window.location.origin : process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
