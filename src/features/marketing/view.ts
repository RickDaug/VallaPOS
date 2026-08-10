/**
 * Pure view selection for the generated marketing markup.
 *
 * Kept in a plain `.ts` module (not MarketingSite.tsx) so it is unit-testable —
 * the repo's tsconfig uses `jsx: "preserve"`, which Vitest cannot parse, so a
 * `.tsx` import from a test fails outright. Same split as the rest of the
 * codebase: pure logic in `.ts`, component in `.tsx`.
 */

/** The top-level views the generated markup ships as sibling `<main>` blocks. */
export type MarketingView = "home" | "about";

/**
 * Mark exactly one top-level view visible in the generated markup.
 *
 * The artifact ships home/about/legal as three sibling `<main class="view">`
 * blocks and toggles `hidden` client-side. That was fine while About was only a
 * hash route, but `/about` is a REAL route now (audit U-4) — so the correct view
 * has to be visible in the SERVER html, or crawlers and no-JS visitors get the
 * home page at the About URL and everyone else sees a flash of it first.
 */
export function htmlForView(html: string, view: MarketingView): string {
  return html.replace(
    /<main class="view" id="view-(home|about|legal)"(?: hidden)?>/g,
    (_m, id: string) => `<main class="view" id="view-${id}"${id === view ? "" : " hidden"}>`,
  );
}
