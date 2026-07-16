/**
 * Canonical public site origin, used for sitemap/robots/canonical/OG URLs.
 *
 * This is the ONE canonical brand domain (vallapos.com), intentionally NOT tied
 * to NEXT_PUBLIC_APP_URL (which is the per-deployment origin — preview/localhost
 * differ). Canonical/sitemap/robots must always point at production, so a
 * preview's canonical correctly references the live site. Overridable via
 * NEXT_PUBLIC_CANONICAL_URL if the brand domain ever changes. No trailing slash.
 */
export const CANONICAL_URL = (
  process.env.NEXT_PUBLIC_CANONICAL_URL ?? "https://vallapos.com"
).replace(/\/$/, "");
