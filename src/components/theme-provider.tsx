"use client";

import type { ReactNode } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

export function ThemeProvider({ children, nonce }: { children: ReactNode; nonce?: string }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      // Forwarded from the root layout (minted per-request in middleware.ts).
      // next-themes stamps its inline no-flash theme <script> with this nonce so
      // the enforced CSP allows it. Undefined when CSP isn't active (e.g. tests).
      nonce={nonce}
    >
      {children}
    </NextThemesProvider>
  );
}
