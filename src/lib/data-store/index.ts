import "server-only";

import { prismaDataStore } from "./prisma-store";
import type { DataStore } from "./types";

export type { DataStore } from "./types";

/**
 * Composition root for the data-store seam. The cloud edition has one impl.
 *
 * Stage 3 branches here on edition — returning the SQLite store when `isLocal`.
 * That will move the impl selection behind an edition-gated (likely dynamic)
 * import so the local build never bundles this `server-only` Prisma path; for now
 * there is a single cloud impl and nothing consumes this yet (additive scaffold).
 */
export function getDataStore(): DataStore {
  return prismaDataStore;
}
