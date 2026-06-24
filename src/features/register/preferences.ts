/**
 * Pure, per-device register preferences (no React/Prisma imports, so they're
 * unit-testable). Two things live here:
 *   1. Favorites — a set of favorited variation ids, persisted per business.
 *   2. Density — the item grid's "grid" vs "list" layout, persisted globally.
 *
 * The pure functions operate on plain data (string[]/strings); the thin
 * localStorage read/write wrappers at the bottom are the only browser-touching
 * part and degrade to no-ops when storage is unavailable (SSR / private mode).
 */

export type Density = "grid" | "list";

export const FAVORITES_PSEUDO_CATEGORY = "★ Favorites";

/** Toggle a variation id in the favorites list (add if absent, remove if present). */
export function toggleFavorite(favorites: readonly string[], variationId: string): string[] {
  return favorites.includes(variationId)
    ? favorites.filter((id) => id !== variationId)
    : [...favorites, variationId];
}

/** Whether a variation id is currently favorited. */
export function isFavorite(favorites: readonly string[], variationId: string): boolean {
  return favorites.includes(variationId);
}

/**
 * Parse a persisted favorites blob into a clean string[]: accepts only an array
 * of strings, drops anything else, and dedupes. Returns [] for malformed input
 * so a corrupt localStorage value can never crash the register.
 */
export function parseFavorites(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    for (const v of parsed) {
      if (typeof v === "string" && v.length > 0 && !out.includes(v)) out.push(v);
    }
    return out;
  } catch {
    return [];
  }
}

/** Normalize a persisted density value, defaulting to "grid". */
export function parseDensity(raw: string | null | undefined): Density {
  return raw === "list" ? "list" : "grid";
}

/** Per-business localStorage key for favorites (favorites are device + business scoped). */
export function favoritesStorageKey(businessId: string): string {
  return `vallapos.register.favorites.${businessId}`;
}

/** Global (per-device) localStorage key for the grid/list density toggle. */
export const DENSITY_STORAGE_KEY = "vallapos.register.density";

// --- thin localStorage wrappers (the only browser-touching code) ---

function safeGet(key: string): string | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, value);
  } catch {
    /* storage full / disabled — preferences are best-effort */
  }
}

export function loadFavorites(businessId: string): string[] {
  return parseFavorites(safeGet(favoritesStorageKey(businessId)));
}

export function saveFavorites(businessId: string, favorites: readonly string[]): void {
  safeSet(favoritesStorageKey(businessId), JSON.stringify([...favorites]));
}

export function loadDensity(): Density {
  return parseDensity(safeGet(DENSITY_STORAGE_KEY));
}

export function saveDensity(density: Density): void {
  safeSet(DENSITY_STORAGE_KEY, density);
}
