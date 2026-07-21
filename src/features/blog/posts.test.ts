import { describe, it, expect } from "vitest";
import {
  getAllPosts,
  getAllSlugs,
  getPost,
  getAuthor,
  AUTHORS,
  formatPostDate,
} from "./index";

const posts = getAllPosts();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe("blog post catalog", () => {
  it("has posts", () => {
    expect(posts.length).toBeGreaterThan(0);
  });

  it("has unique slugs", () => {
    const slugs = posts.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses kebab-case slugs", () => {
    for (const p of posts) {
      expect(p.slug, p.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("references only known authors", () => {
    for (const p of posts) {
      expect(AUTHORS[p.authorId], `${p.slug} → ${p.authorId}`).toBeDefined();
    }
  });

  it("uses both bylines", () => {
    const usedAuthors = new Set(posts.map((p) => p.authorId));
    expect(usedAuthors.has("terry-b")).toBe(true);
    expect(usedAuthors.has("rick-d")).toBe(true);
  });

  it("has valid ISO publish dates", () => {
    for (const p of posts) {
      expect(p.date, p.slug).toMatch(ISO_DATE);
      expect(Number.isNaN(Date.parse(`${p.date}T00:00:00Z`)), p.slug).toBe(false);
    }
  });

  it("has non-empty title, description, category, tags and body", () => {
    for (const p of posts) {
      expect(p.title.length, p.slug).toBeGreaterThan(0);
      expect(p.description.trim().length, p.slug).toBeGreaterThan(0);
      expect(p.category.length, p.slug).toBeGreaterThan(0);
      expect(p.tags.length, p.slug).toBeGreaterThan(0);
      expect(p.body.length, p.slug).toBeGreaterThan(400);
    }
  });

  it("keeps meta descriptions to a search-snippet length", () => {
    for (const p of posts) {
      expect(p.description.length, `${p.slug} (${p.description.length} chars)`).toBeLessThanOrEqual(
        200,
      );
    }
  });
});

describe("catalog helpers", () => {
  it("getAllPosts is sorted newest-first", () => {
    for (let i = 1; i < posts.length; i++) {
      expect(posts[i - 1]!.date >= posts[i]!.date).toBe(true);
    }
  });

  it("getAllSlugs matches the catalog", () => {
    expect(new Set(getAllSlugs())).toEqual(new Set(posts.map((p) => p.slug)));
  });

  it("getPost resolves every slug and null for unknown", () => {
    for (const slug of getAllSlugs()) {
      expect(getPost(slug)?.slug).toBe(slug);
    }
    expect(getPost("does-not-exist")).toBeNull();
  });

  it("getAuthor throws on an unknown id", () => {
    expect(() => getAuthor("nobody")).toThrow();
  });

  it("formatPostDate renders a stable en-US date", () => {
    expect(formatPostDate("2026-06-23")).toBe("June 23, 2026");
  });
});
