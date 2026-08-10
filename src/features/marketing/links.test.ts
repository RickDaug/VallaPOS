import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MARKETING_HTML, MARKETING_CSS } from "./marketing-content";
import { htmlForView } from "./view";

/**
 * Link integrity for the generated marketing site.
 *
 * The site is ported from a hash-routed design artifact, so its internal links
 * pass through a rewrite step in scripts/marketing/generate.mjs. Nothing checked
 * the output of that step, and the consequences shipped to production: the nav
 * linked to `#/about` while `/about` returned 404, every legal policy was
 * reachable only by running the hash router, and all six conversion CTAs were
 * inert `#/#pricing` fragments until React hydrated.
 *
 * These tests assert the property that was missing: every link in the generated
 * markup points at something that exists, and the buttons the business depends
 * on point where they are supposed to — from the SERVER html, before any JS.
 */

const REPO_ROOT = join(__dirname, "..", "..", "..");

/** Every `href="…"` in the generated markup, in document order. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1] ?? "");
}

/** Anchors only — excludes `<use href="#i-…">` SVG sprite references. */
function anchorHrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((m) => m[1] ?? "");
}

/**
 * Does an app route exist on disk for this path? Mirrors Next's App Router file
 * convention: `/about` → `app/about/page.tsx`, `/desktop/buy` → a `route.ts`.
 * Route GROUPS are transparent in the URL, so `/sign-in` may live at
 * `app/(auth)/sign-in/page.tsx` — check the group directories too.
 */
function routeExists(path: string): boolean {
  const appDir = join(REPO_ROOT, "app");
  const groups = readdirSync(appDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("(") && e.name.endsWith(")"))
    .map((e) => e.name);
  const segments = path.split("/").filter(Boolean);

  return ["", ...groups].some((group) =>
    ["page.tsx", "route.ts"].some((file) =>
      existsSync(join(appDir, ...(group ? [group] : []), ...segments, file)),
    ),
  );
}

/** Fragment ids the markup defines, for verifying same-page anchors. */
function definedIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1] ?? ""));
}

describe("marketing site link integrity", () => {
  it("has no leftover hash-router links", () => {
    // `#/about`, `#/privacy`, `#/#pricing` — the artifact's SPA routing. Every
    // one of these must have been rewritten to a real route by generate.mjs.
    const leftovers = hrefs(MARKETING_HTML).filter((h) => h.startsWith("#/"));
    expect(leftovers).toEqual([]);
  });

  it("points every internal link at a route that exists", () => {
    const broken = anchorHrefs(MARKETING_HTML)
      .filter((h) => h.startsWith("/") && !h.startsWith("//"))
      .map((h) => h.split("#")[0] ?? "")
      .filter((path) => path !== "" && path !== "/")
      .filter((path) => !routeExists(path));

    expect(broken).toEqual([]);
  });

  it("resolves every same-page anchor to an element that exists", () => {
    const ids = definedIds(MARKETING_HTML);
    const dangling = anchorHrefs(MARKETING_HTML)
      .filter((h) => h.includes("#") && !h.startsWith("#i-"))
      .map((h) => h.split("#")[1] ?? "")
      .filter((frag) => frag !== "" && !ids.has(frag));

    expect(dangling).toEqual([]);
  });

  it("sends every conversion CTA to a real destination in the server html", () => {
    // The regression this guards: these hrefs used to be `#/#pricing` and were
    // patched in a useEffect, so a tap during hydration did nothing.
    const buyAnchors = [...MARKETING_HTML.matchAll(/<a\b[^>]*\bdata-buy="(cloud|offline)"[^>]*>/g)];
    expect(buyAnchors.length).toBeGreaterThanOrEqual(6);

    for (const [tag, kind] of buyAnchors) {
      const href = tag.match(/href="([^"]*)"/)?.[1];
      expect(href).toBe(kind === "cloud" ? "/sign-up" : "/desktop/buy");
    }
  });

  it("sends the bare Start free / Get started CTAs to sign-up", () => {
    const plainCtas = [
      ...MARKETING_HTML.matchAll(/<a class="btn (?:nav__cta|btn--onNavy btn--lg)" href="([^"]*)"/g),
    ].map((m) => m[1]);

    expect(plainCtas.length).toBeGreaterThanOrEqual(3);
    expect(new Set(plainCtas)).toEqual(new Set(["/sign-up"]));
  });

  it("keeps the legal documents single-sourced and extractable", () => {
    // app/{privacy,terms,disputes,dmca,do-not-sell}/page.tsx each pull their body
    // out of MARKETING_HTML by this exact pattern. A markup change that broke the
    // shape would silently empty those pages.
    for (const doc of ["privacy", "terms", "disputes", "dmca", "do-not-sell"]) {
      const body = MARKETING_HTML.match(
        new RegExp(`<article class="legal-doc" id="doc-${doc}">([\\s\\S]*?)</article>`),
      )?.[1];
      expect(body, `legal doc "${doc}" not extractable`).toBeTruthy();
      expect(body!.length).toBeGreaterThan(500);
    }
  });

  it("leaves no unfilled generator placeholders", () => {
    // The artifact ships `[domain]`, `[Company legal name]`, `[mailing address]`
    // etc. for generate.mjs to fill. One that slips through lands in a published
    // legal policy.
    const placeholders = [...MARKETING_HTML.matchAll(/\[[A-Za-z][^\]]{2,40}\]/g)].map((m) => m[0]);
    expect(placeholders).toEqual([]);
  });
});

describe("htmlForView", () => {
  it("keeps exactly the requested view and drops the others", () => {
    for (const view of ["home", "about"] as const) {
      const out = htmlForView(MARKETING_HTML, view);
      const views = [...out.matchAll(/<main class="view" id="view-([a-z]+)"( hidden)?>/g)];

      expect(views.map((m) => m[1])).toEqual([view]);
      // The surviving view must be VISIBLE — `hidden` has to be stripped, or the
      // page renders blank below the nav.
      expect(views[0]![2]).toBeUndefined();
    }
  });

  it("relies on <main> not nesting, so the non-greedy match can't over-capture", () => {
    // If a future artifact ever nests a <main>, the regex would swallow markup
    // past the intended close tag. Pin the assumption rather than trust it.
    expect((MARKETING_HTML.match(/<main\b/g) ?? []).length).toBe(3);
    expect((MARKETING_HTML.match(/<\/main>/g) ?? []).length).toBe(3);
  });

  it("keeps the shared nav and footer, which live outside the views", () => {
    const out = htmlForView(MARKETING_HTML, "about");
    expect(out).toContain('href="/sign-in"');
    expect(out).toContain("<footer");
    expect(out).toContain("</footer>");
  });

  it("cuts most of the document weight, which is the point", () => {
    // The five legal policies alone are >50% of the markup and were shipped
    // `hidden` on every home-page hit, on a response served `no-store`.
    const home = htmlForView(MARKETING_HTML, "home");
    expect(home.length).toBeLessThan(MARKETING_HTML.length * 0.5);
    expect(htmlForView(MARKETING_HTML, "about").length).toBeLessThan(
      MARKETING_HTML.length * 0.25,
    );
  });

  it("leaves the legal documents extractable from the untouched constant", () => {
    // The legal ROUTES read MARKETING_HTML directly, so dropping views from a
    // rendered page must not disturb the source of truth.
    expect(MARKETING_HTML).toContain('<article class="legal-doc" id="doc-privacy">');
  });
});

describe("generated marketing content", () => {
  it("carries the app's theme class rather than the artifact's data-theme system", () => {
    expect(MARKETING_CSS).not.toContain("[data-theme=");
    expect(MARKETING_CSS).toContain(":root.dark");
  });
});
