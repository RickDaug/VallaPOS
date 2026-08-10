import type { Metadata } from "next";
import MarketingSite from "@/features/marketing/MarketingSite";

/**
 * The About page as a REAL route (audit U-4).
 *
 * It used to exist only as the client-side hash route `#/about`, so
 * `vallapos.com/about` — the URL anyone would type, share, or link — returned a
 * 404, and the content was invisible to anything that doesn't run the hash
 * router. Rendering `MarketingSite` with `view="about"` serves the same
 * single-sourced markup with the About view visible in the SERVER html, keeping
 * the site's nav, footer, and styling intact.
 */
export const metadata: Metadata = {
  title: "About",
  description:
    "Why VallaPOS exists: a register built for food trucks, barbers, market stalls and small shops — not for chains with countertops and contracts.",
  alternates: { canonical: "/about" },
  openGraph: {
    title: "About VallaPOS — point of sale, on the side of the little guy",
    description:
      "Why VallaPOS exists: a register built for food trucks, barbers, market stalls and small shops.",
  },
};

export default function AboutPage() {
  return <MarketingSite view="about" />;
}
