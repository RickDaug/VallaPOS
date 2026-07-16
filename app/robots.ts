import type { MetadataRoute } from "next";
import { CANONICAL_URL } from "@/lib/site";

// Allow crawling of the public marketing + auth surface; keep crawlers out of
// authenticated per-business app routes, API handlers, and the offline
// fallback. Points at the sitemap.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/start", "/~offline"],
    },
    sitemap: `${CANONICAL_URL}/sitemap.xml`,
    host: CANONICAL_URL,
  };
}
