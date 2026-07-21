import type { BlogPost } from "./types";
import { readingTimeMinutes } from "./markdown";
import takePaymentsFarmersMarket from "./posts/take-payments-farmers-market";
import posThatDoesntTakeACut from "./posts/pos-that-doesnt-take-a-cut";
import sellOfflineNoWifi from "./posts/sell-offline-no-wifi";
import cashCardQrWhatToAccept from "./posts/cash-card-qr-what-to-accept";
import barbershopDailyCashCount from "./posts/barbershop-daily-cash-count";
import foodTruckPosSetup from "./posts/food-truck-pos-setup";

export type { BlogPost } from "./types";
export type { Author } from "./types";
export { getAuthor, AUTHORS } from "./authors";
export { renderMarkdown, readingTimeMinutes } from "./markdown";

// The full post set. Order here doesn't matter — getAllPosts sorts by date.
const POSTS: BlogPost[] = [
  takePaymentsFarmersMarket,
  posThatDoesntTakeACut,
  sellOfflineNoWifi,
  cashCardQrWhatToAccept,
  barbershopDailyCashCount,
  foodTruckPosSetup,
];

/** All posts, newest first. */
export function getAllPosts(): BlogPost[] {
  return [...POSTS].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** All post slugs (for generateStaticParams). */
export function getAllSlugs(): string[] {
  return POSTS.map((p) => p.slug);
}

/** Look up one post by slug, or null if it doesn't exist. */
export function getPost(slug: string): BlogPost | null {
  return POSTS.find((p) => p.slug === slug) ?? null;
}

/** Human-readable date, e.g. "June 23, 2026". Locale-stable (UTC, en-US). */
export function formatPostDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** Reading-time label, e.g. "4 min read". */
export function readingTimeLabel(post: BlogPost): string {
  return `${readingTimeMinutes(post.body)} min read`;
}
