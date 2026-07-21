import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_HTML } from "@/features/marketing/marketing-content";

// The legal documents are single-sourced in the generated marketing content as
// `<article class="legal-doc" id="doc-*">` blocks. We extract the body for this
// route and render it server-side so `/do-not-sell` serves real, crawlable
// content (the marketing SPA only exposes it at the non-crawlable hash route).
const DOC_ID = "do-not-sell";

export const metadata: Metadata = {
  title: "Do Not Sell or Share My Personal Information",
  description:
    "VallaPOS does not sell or share your personal information — your CCPA/CPRA privacy rights explained.",
  alternates: { canonical: "/do-not-sell" },
};

function legalDocHtml(id: string): string {
  const match = MARKETING_HTML.match(
    new RegExp(`<article class="legal-doc" id="doc-${id}">([\\s\\S]*?)</article>`),
  );
  // Rewrite the SPA hash cross-links (`#/privacy`) to the real routes (`/privacy`).
  return (match?.[1] ?? "").replace(/href="#\//g, 'href="/');
}

// Scoped legal typography, mirroring the marketing site's `.legal-doc` rules but
// mapped onto the app's design tokens so it stays theme-aware. Inline styles are
// permitted by the CSP; this is static trusted content.
const LEGAL_STYLES = `
.legal-doc { font-size: 1rem; line-height: 1.65; }
.legal-doc .legal-note { font-size: 0.86rem; color: var(--muted-foreground); font-style: italic; padding: 12px 16px; background: var(--muted); border-radius: 10px; margin-bottom: 22px; }
.legal-doc .legal-lead { font-size: 1.1rem; color: var(--foreground); margin-bottom: 8px; }
.legal-doc h2 { font-size: 1.32rem; font-weight: 720; margin: 34px 0 10px; letter-spacing: -0.01em; }
.legal-doc h3 { font-size: 1.06rem; font-weight: 680; margin: 22px 0 8px; }
.legal-doc p { color: var(--muted-foreground); margin: 10px 0; }
.legal-doc ul { color: var(--muted-foreground); margin: 10px 0; padding-left: 22px; list-style: disc; }
.legal-doc li { margin: 6px 0; }
.legal-doc strong { color: var(--foreground); font-weight: 650; }
.legal-doc a { color: var(--primary); font-weight: 550; text-decoration: underline; }
`;

export default function DoNotSellPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <Link href="/" className="text-sm font-semibold text-primary underline">
        &larr; Back to home
      </Link>
      <h1 className="mt-6 text-3xl font-black tracking-tight sm:text-4xl">
        Do Not Sell or Share My Personal Information
      </h1>
      <style>{LEGAL_STYLES}</style>
      <div className="legal-doc mt-8" dangerouslySetInnerHTML={{ __html: legalDocHtml(DOC_ID) }} />
    </main>
  );
}
