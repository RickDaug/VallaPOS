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
 * Keep only the requested top-level view, dropping the others entirely.
 *
 * The artifact ships home/about/legal as three sibling `<main class="view">`
 * blocks and toggles `hidden` client-side. Two problems with shipping all three:
 *
 *  1. `/about` is a REAL route now (audit U-4), so the right view has to be in
 *     the SERVER html — otherwise crawlers and no-JS visitors get the home page
 *     at the About URL, and everyone else sees a flash of it first.
 *  2. The five legal policies are 33.5 KB — **53% of the entire document** — and
 *     the About view another 4.9 KB, both `hidden` on every home-page hit. The
 *     page is served `Cache-Control: no-store` (the root layout reads `headers()`
 *     for the CSP nonce, which makes every route dynamic), so that is re-sent in
 *     full to every visitor, every time. Removing rather than hiding cuts ~61%
 *     off the response for the phones-on-patchy-LTE audience this targets.
 *
 * Dropping them is safe: the legal routes extract their bodies from the
 * MARKETING_HTML *constant*, not from this output, and MarketingSite redirects
 * legacy `#/about` / `#/privacy` hash links to the real routes.
 *
 * There are exactly three `<main>` elements in the document and they do not
 * nest, so the non-greedy match to `</main>` cannot over-capture —
 * `links.test.ts` pins both facts.
 */
export function htmlForView(html: string, view: MarketingView): string {
  return html.replace(
    /<main class="view" id="view-(home|about|legal)"(?: hidden)?>[\s\S]*?<\/main>/g,
    (block, id: string) =>
      id === view ? block.replace(` id="view-${id}" hidden>`, ` id="view-${id}">`) : "",
  );
}
