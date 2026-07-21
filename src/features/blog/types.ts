/**
 * Blog content model.
 *
 * Posts are plain, server-rendered data (no CMS, no MDX dependency) so the whole
 * blog ships as static, crawlable HTML that our strict CSP allows without any
 * `dangerouslySetInnerHTML` — the marketing site needs that hack; the blog does
 * not. Bodies are authored in a small Markdown subset (see ./markdown).
 */

export interface Author {
  /** URL-safe id used nowhere public yet, but stable for future author pages. */
  id: string;
  /** Byline as shown on the post, e.g. "Terry B." */
  name: string;
  /** One-line role under the byline. */
  role: string;
  /** Short bio for the byline card at the foot of a post. */
  bio: string;
  /** Two-letter monogram for the avatar chip. */
  initials: string;
}

export interface BlogPost {
  /** URL slug: /blog/<slug>. Unique, kebab-case. */
  slug: string;
  /** H1 + <title>. */
  title: string;
  /** Meta description + card summary. ~150–160 chars for search snippets. */
  description: string;
  /** Author id (see ./authors). */
  authorId: string;
  /** ISO date (YYYY-MM-DD) the post was published. */
  date: string;
  /** Coarse content bucket shown as an eyebrow, e.g. "How-to", "Guide". */
  category: string;
  /** Search/topic tags. */
  tags: string[];
  /** Markdown-subset body (see ./markdown for supported syntax). */
  body: string;
}
