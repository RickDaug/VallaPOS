import { describe, it, expect } from "vitest";

import { PAGE_CACHE_NAMES, purgePageCaches } from "./page-caches";

/** Minimal fake of the browser `CacheStorage` surface purgePageCaches uses. */
function fakeCacheStorage(initial: string[]) {
  const names = new Set(initial);
  return {
    deleted: [] as string[],
    async keys() {
      return [...names];
    },
    async delete(name: string) {
      this.deleted.push(name);
      return names.delete(name);
    },
  };
}

describe("PAGE_CACHE_NAMES", () => {
  // R3-#3: pin the Serwist page-cache names so a Serwist upgrade that RENAMES a
  // cache fails CI here (forcing the purge list — and app/sw.ts — to be updated)
  // instead of silently leaving a previous operator's authed pages cached.
  it("is exactly the expected Serwist page caches", () => {
    expect([...PAGE_CACHE_NAMES]).toEqual(["pages", "pages-rsc", "pages-rsc-prefetch"]);
  });
});

describe("purgePageCaches", () => {
  it("deletes every pinned page cache and leaves non-page caches alone", async () => {
    const cs = fakeCacheStorage(["pages", "pages-rsc", "pages-rsc-prefetch", "keep-me"]);
    await purgePageCaches(cs as unknown as CacheStorage);
    for (const name of PAGE_CACHE_NAMES) expect(cs.deleted).toContain(name);
    expect(cs.deleted).not.toContain("keep-me");
  });

  it("also deletes a RENAMED page cache by prefix (survives a Serwist rename)", async () => {
    // Simulate a Serwist upgrade renaming caches to new `pages*` names NOT in the
    // pinned list — the prefix sweep must still purge them.
    const cs = fakeCacheStorage(["pages-v2", "pages-rsc-next", "static-assets"]);
    await purgePageCaches(cs as unknown as CacheStorage);
    expect(cs.deleted).toContain("pages-v2");
    expect(cs.deleted).toContain("pages-rsc-next");
    expect(cs.deleted).not.toContain("static-assets");
  });

  it("attempts the pinned names even when the store lists none of them", async () => {
    const cs = fakeCacheStorage([]);
    await purgePageCaches(cs as unknown as CacheStorage);
    for (const name of PAGE_CACHE_NAMES) expect(cs.deleted).toContain(name);
  });

  it("never throws when the CacheStorage errors (best effort)", async () => {
    const broken = {
      async keys(): Promise<string[]> {
        throw new Error("Cache Storage unavailable");
      },
      async delete() {
        return false;
      },
    };
    await expect(purgePageCaches(broken as unknown as CacheStorage)).resolves.toBeUndefined();
  });
});
