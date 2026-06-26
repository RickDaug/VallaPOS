import "./globals.css";
import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import { ToastProvider } from "@/components/ui/toast";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

// Absolute base for canonical/OG URLs. NEXT_PUBLIC_APP_URL is validated at build
// (src/lib/env.ts); the fallback only guards local/preview where it's unset.
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://valla-pos.vercel.app";
const description = "Browser-based point of sale for mobile and local businesses.";

export const metadata: Metadata = {
  metadataBase: new URL(appUrl),
  // `default` is used as-is; child pages that set a title render "<title> · VallaPOS".
  title: {
    default: "VallaPOS — Point of sale for mobile & local business",
    template: "%s · VallaPOS",
  },
  description,
  applicationName: "VallaPOS",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "VallaPOS" },
  openGraph: {
    type: "website",
    siteName: "VallaPOS",
    title: "VallaPOS — Point of sale for mobile & local business",
    description,
    url: appUrl,
  },
  twitter: { card: "summary", title: "VallaPOS", description },
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1d23" },
  ],
  width: "device-width",
  initialScale: 1,
  // Note: pinch-zoom is intentionally NOT locked globally (WCAG 1.4.4). The
  // register screen locks zoom locally via a body class where appropriate.
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Per-request CSP nonce minted in middleware.ts and forwarded on `x-nonce`.
  // We hand it to next-themes so its inline no-flash theme `<script>` carries a
  // matching `nonce-` and isn't blocked by the enforced Content-Security-Policy.
  // (Next.js stamps its own inline bootstrap scripts with the same nonce
  // automatically, reading it from the CSP it sees on the request.)
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider nonce={nonce}>
          <ToastProvider>{children}</ToastProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
