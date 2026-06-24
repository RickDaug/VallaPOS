import { describe, it, expect } from "vitest";
import {
  toggleFavorite,
  isFavorite,
  parseFavorites,
  parseDensity,
  favoritesStorageKey,
  DENSITY_STORAGE_KEY,
} from "@/features/register/preferences";

describe("toggleFavorite", () => {
  it("adds an id when absent and removes it when present", () => {
    expect(toggleFavorite([], "a")).toEqual(["a"]);
    expect(toggleFavorite(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleFavorite(["a", "b"], "a")).toEqual(["b"]);
  });

  it("does not mutate the input array", () => {
    const input = ["a"];
    toggleFavorite(input, "b");
    expect(input).toEqual(["a"]);
  });
});

describe("isFavorite", () => {
  it("reports membership", () => {
    expect(isFavorite(["a", "b"], "a")).toBe(true);
    expect(isFavorite(["a", "b"], "z")).toBe(false);
    expect(isFavorite([], "a")).toBe(false);
  });
});

describe("parseFavorites", () => {
  it("returns a clean string[] for a valid blob, deduped", () => {
    expect(parseFavorites('["a","b","a"]')).toEqual(["a", "b"]);
  });

  it("returns [] for null/blank/malformed input", () => {
    expect(parseFavorites(null)).toEqual([]);
    expect(parseFavorites("")).toEqual([]);
    expect(parseFavorites("not json")).toEqual([]);
    expect(parseFavorites('{"a":1}')).toEqual([]);
  });

  it("drops non-string and empty entries", () => {
    expect(parseFavorites('["a", 1, null, "", "b"]')).toEqual(["a", "b"]);
  });
});

describe("parseDensity", () => {
  it("accepts 'list', defaults everything else to 'grid'", () => {
    expect(parseDensity("list")).toBe("list");
    expect(parseDensity("grid")).toBe("grid");
    expect(parseDensity(null)).toBe("grid");
    expect(parseDensity("bogus")).toBe("grid");
  });
});

describe("storage keys", () => {
  it("scopes favorites per business and keeps density global", () => {
    expect(favoritesStorageKey("biz_1")).toBe("vallapos.register.favorites.biz_1");
    expect(favoritesStorageKey("biz_2")).not.toBe(favoritesStorageKey("biz_1"));
    expect(DENSITY_STORAGE_KEY).toBe("vallapos.register.density");
  });
});
