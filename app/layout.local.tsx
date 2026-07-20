import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  title: "VallaPOS Desktop",
  description: "Offline point of sale.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1d23" },
  ],
  width: "device-width",
  initialScale: 1,
};

/**
 * Offline-edition root layout (docs/EDITIONS.md §5b). Mirrors the cloud root shell
 * but WITHOUT the per-request CSP nonce (`headers()` — a dynamic API banned under
 * `output:'export'`; there is no middleware/CSP in the desktop build) and without
 * the PWA manifest. The staging build (`scripts/build-local.mjs`) swaps this over
 * `app/layout.tsx` for the local build only; cloud is untouched.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
