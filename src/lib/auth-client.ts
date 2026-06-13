"use client";

import { createAuthClient } from "better-auth/react";

/** Better Auth browser client. Use in client components for sign-in/out hooks. */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL,
});

export const { signIn, signUp, signOut, useSession } = authClient;
