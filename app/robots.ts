import type { MetadataRoute } from "next";
import { CANONICAL_URL } from "@/lib/site";

// Allow crawling of the public marketing + auth surface; keep crawlers out of
// API handlers, the offline fallback, and transactional/utility routes (the
// license-activation and post-checkout pages). Points at the sitemap.
//
// NOTE: the authenticated per-business tree lives under a dynamic segment
// (`/{businessId}/*`, a cuid), which has no clean static prefix to disallow
// here. Those routes are kept out of search via layout-level `robots.index:
// false` on the (app) route group, not via this file.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/start", "/~offline", "/desktop/", "/pay/"],
    },
    sitemap: `${CANONICAL_URL}/sitemap.xml`,
    host: CANONICAL_URL,
  };
}
