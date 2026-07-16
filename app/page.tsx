import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getPrimaryBusinessId } from "@/features/auth/actions";
import MarketingSite from "@/features/marketing/MarketingSite";

const description =
  "Fast, offline-ready point of sale for food trucks, barbers, market stalls & small shops. Cash & QR ready, works with no signal, and never takes a cut of your sales.";

export const metadata: Metadata = {
  title: "VallaPOS — Point of sale for people who sell on the move",
  description,
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

export default async function HomePage() {
  // Session-aware routing (audit R4 #3): a returning, already-authenticated owner
  // should land on their till — not the marketing surface. Resolve their primary
  // business server-side and redirect to its register; a signed-in user with no
  // business yet goes to the create-business recovery page. The PWA start_url is
  // "/", so an installed till launches here and lands on the register in one hop.
  // Unauthenticated visitors get the public marketing site.
  const session = await auth.api.getSession({ headers: await headers() });
  if (session) {
    const businessId = await getPrimaryBusinessId();
    redirect(businessId ? `/${businessId}/register` : "/start");
  }

  return <MarketingSite />;
}
