import type { MetadataRoute } from "next";
import { CANONICAL_URL } from "@/lib/site";
import { getAllPosts } from "@/features/blog";

// Only public, crawlable URLs. The marketing site's About/Legal views are
// hash-routed (#/about, #/privacy…), so they aren't distinct URLs for crawlers
// — their content is served in the "/" document itself. The blog, by contrast,
// is real per-post routes, so each post is listed. Authenticated per-business
// app routes are intentionally excluded (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const posts = getAllPosts();

  return [
    { url: `${CANONICAL_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${CANONICAL_URL}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    ...posts.map((post) => ({
      url: `${CANONICAL_URL}/blog/${post.slug}`,
      lastModified: new Date(`${post.date}T00:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    { url: `${CANONICAL_URL}/sign-up`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${CANONICAL_URL}/sign-in`, lastModified: now, changeFrequency: "monthly", priority: 0.4 },
  ];
}
