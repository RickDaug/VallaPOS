/**
 * Serwist PAGE-cache purge helpers, extracted here (plain TS, no JSX) so they can
 * be unit-tested under Vitest without rendering the `SignOutButton` client
 * component. See SignOutButton.tsx for where these run at sign-out.
 *
 * ── Why this exists (R3-#3) ──────────────────────────────────────────────────
 * On a shared device, an offline navigation after a user switch must NOT serve the
 * previous operator's authenticated, business-scoped pages. Those live in Serwist's
 * runtime PAGE caches (written by `defaultCache`'s NetworkFirst handler). We purge
 * them on sign-out — pinning the known names so a Serwist rename fails CI, AND
 * deleting by prefix so a rename is still purged in the field even before the
 * pinned list is updated.
 */

/**
 * The Serwist runtime caches that hold authenticated, business-scoped PAGE content.
 * These are the current Serwist/Next defaults; they are PINNED here AND asserted in
 * page-caches.test.ts so a Serwist upgrade that RENAMES a cache fails CI instead of
 * silently leaving a stale, cross-operator cache behind. Kept in sync with the
 * page-cache comments in app/sw.ts.
 */
export const PAGE_CACHE_NAMES = ["pages", "pages-rsc", "pages-rsc-prefetch"] as const;

/**
 * Prefix every Serwist page cache shares. Deleting by prefix (not just the pinned
 * names) means a Serwist rename like `pages` → `pages-v2` is STILL purged, so a
 * silent drift can't leave the previous operator's authed pages readable offline.
 */
const PAGE_CACHE_PREFIX = "pages";

/**
 * Purge every Serwist page cache from a `CacheStorage`: the pinned
 * {@link PAGE_CACHE_NAMES} PLUS any cache whose name starts with the page-cache
 * prefix (so a renamed cache is still deleted). Best effort — never throws, so it
 * can never block sign-out.
 */
export async function purgePageCaches(cacheStorage: CacheStorage): Promise<void> {
  try {
    const existing = await cacheStorage.keys();
    const toDelete = new Set<string>(PAGE_CACHE_NAMES);
    for (const name of existing) {
      if (name.startsWith(PAGE_CACHE_PREFIX)) toDelete.add(name);
    }
    await Promise.all([...toDelete].map((name) => cacheStorage.delete(name)));
  } catch {
    // Cache Storage unavailable / a delete failed — nothing more to purge.
  }
}
