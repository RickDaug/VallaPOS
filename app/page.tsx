import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPrimaryBusinessId } from "@/features/auth/actions";
import MarketingSite from "@/features/marketing/MarketingSite";
import { CANONICAL_URL } from "@/lib/site";

const description =
  "Fast, offline-ready point of sale for food trucks, barbers, market stalls & small shops. Cash & QR ready, works with no signal, and never takes a cut of your sales.";

export const metadata: Metadata = {
  title: "VallaPOS — Point of sale for people who sell on the move",
  description,
  alternates: { canonical: "/" },
  openGraph: {
    title: "VallaPOS — Run your register anywhere. Even off the grid.",
    description,
  },
  twitter: {
    card: "summary_large_image",
    title: "VallaPOS — Run your register anywhere. Even off the grid.",
    description,
  },
};

// Structured data for rich results: the organisation + the product with its two
// pricing offers ($19.99/mo Cloud subscription, $99 one-time Offline license).
const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${CANONICAL_URL}/#organization`,
      name: "VallaPOS",
      url: `${CANONICAL_URL}/`,
      description,
    },
    {
      "@type": "SoftwareApplication",
      name: "VallaPOS",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web, Windows, macOS",
      description,
      publisher: { "@id": `${CANONICAL_URL}/#organization` },
      offers: [
        {
          "@type": "Offer",
          name: "VallaPOS Cloud",
          price: "19.99",
          priceCurrency: "USD",
          category: "subscription",
        },
        {
          "@type": "Offer",
          name: "VallaPOS Offline",
          price: "99.00",
          priceCurrency: "USD",
          category: "one-time",
        },
      ],
    },
  ],
};

export default async function HomePage() {
  // Session-aware routing (audit R4 #3): a returning, already-authenticated owner
  // should land on their till — not the marketing surface. Resolve their primary
  // business server-side and redirect to its register; a signed-in user with no
  // business yet goes to the create-business recovery page. The PWA start_url is
  // "/", so an installed till launches here and lands on the register in one hop.
  // Unauthenticated visitors get the public marketing site.
  const headerList = await headers();
  const session = await auth.api.getSession({ headers: headerList });
  if (session) {
    const businessId = await getPrimaryBusinessId();
    redirect(businessId ? `/${businessId}/register` : "/start");
  }

  // Nonce the JSON-LD block so the enforced CSP (strict script-src) allows it.
  const nonce = headerList.get("x-nonce") ?? undefined;

  return (
    <>
      <script
        type="application/ld+json"
        nonce={nonce}
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingSite />
    </>
  );
}
