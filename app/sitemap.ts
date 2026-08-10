import type { MetadataRoute } from "next";
import { CANONICAL_URL } from "@/lib/site";

// Only public, crawlable URLs. Authenticated per-business app routes are
// intentionally excluded (see robots.ts).
//
// About and the legal documents used to be omitted here because they were
// hash-routed (#/about, #/privacy…) and therefore not distinct URLs. They are
// real routes now (audit U-3/U-4) — server-rendered, linked from the site nav
// and footer — so they belong in the sitemap. The legal pages in particular
// need a stable, indexable URL: Stripe and app stores expect to find them, and
// a policy nobody can link to is a policy nobody can rely on.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const page = (
    path: string,
    priority: number,
    changeFrequency: "weekly" | "monthly" | "yearly",
  ) => ({ url: `${CANONICAL_URL}${path}`, lastModified: now, changeFrequency, priority });

  return [
    page("/", 1, "weekly"),
    page("/about", 0.7, "monthly"),
    page("/sign-up", 0.6, "monthly"),
    page("/sign-in", 0.4, "monthly"),
    page("/terms", 0.3, "yearly"),
    page("/privacy", 0.3, "yearly"),
    page("/disputes", 0.2, "yearly"),
    page("/dmca", 0.2, "yearly"),
    page("/do-not-sell", 0.2, "yearly"),
  ];
}
