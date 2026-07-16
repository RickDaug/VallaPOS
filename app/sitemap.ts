import type { MetadataRoute } from "next";
import { CANONICAL_URL } from "@/lib/site";

// Only public, crawlable URLs. The marketing site's About/Legal views are
// hash-routed (#/about, #/privacy…), so they aren't distinct URLs for crawlers
// — their content is served in the "/" document itself. Authenticated
// per-business app routes are intentionally excluded (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${CANONICAL_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${CANONICAL_URL}/sign-up`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${CANONICAL_URL}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];
}
