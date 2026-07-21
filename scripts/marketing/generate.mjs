/**
 * Regenerate src/features/marketing/marketing-content.ts from the published
 * design artifact (artifact-source.html, a self-contained marketing SPA).
 *
 * The artifact's <style> and body markup are extracted verbatim; only two
 * transforms are applied:
 *   1. dark-mode selectors are rewritten from the artifact's own [data-theme]
 *      system to next-themes' `.dark` class, so the site shares ONE theme with
 *      the app;
 *   2. placeholders are filled ([domain] -> vallapos.com, dates, etc.) and a
 *      "Sign in" link is inserted into the nav.
 * The artifact's inline <script> is intentionally dropped — its behaviour is
 * re-implemented CSP-safely in MarketingSite.tsx (the enforced script-src has
 * no 'unsafe-inline').
 *
 * Run from the repo root:  node scripts/marketing/generate.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = join(here, "artifact-source.html");
const OUT = join(here, "..", "..", "src", "features", "marketing", "marketing-content.ts");

let raw = readFileSync(SRC, "utf8");

// --- extract CSS (inner of the first <style>...</style>) ---
const styleMatch = raw.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error("no <style> found");
let css = styleMatch[1].trim();
css = css
  .replaceAll(':root:not([data-theme="light"])', ":root.dark")
  .replaceAll(':root[data-theme="dark"]', ":root.dark");

// --- extract BODY: from the icon sprite <svg ...> through </footer> ---
const spriteStart = raw.indexOf('<svg width="0" height="0"');
const footerEnd = raw.indexOf("</footer>");
if (spriteStart === -1 || footerEnd === -1) throw new Error("body markers not found");
let html = raw.slice(spriteStart, footerEnd + "</footer>".length);

// --- placeholder + presentation replacements ---
html = html
  // Legal/privacy/DMCA contact routes to the company's legal inbox (vallahub.com);
  // product support stays on the product domain. These run BEFORE the generic
  // [domain] fill so support@[domain] still becomes support@vallapos.com.
  .replaceAll("legal@[domain]", "legal@vallahub.com")
  .replaceAll("privacy@[domain]", "legal@vallahub.com")
  .replaceAll("dmca@[domain]", "legal@vallahub.com")
  .replaceAll("[domain]", "vallapos.com")
  .replaceAll("[Company legal name]", "VallaPOS")
  .replaceAll("[State of Texas, USA]", "the State of Texas, USA")
  .replaceAll("[DATE]", "July 15, 2026")
  .replaceAll("[30]", "30")
  // Real legal entity details (provided by the business).
  .replaceAll("[mailing address]", "1942 W Gray St., Unit #115, Houston, TX 77019")
  .replaceAll("[DMCA Designated Agent name]", "Attn: DMCA Agent");

// Insert a "Sign in" link before the "Start free" CTA so returning owners have
// an obvious way back in (the pure-marketing artifact had none).
html = html.replace(
  '<a class="btn nav__cta"',
  '<a class="nav__link nav__signin" href="/sign-in">Sign in</a>\n      <a class="btn nav__cta"',
);

// Escape for a JS template literal (backticks, ${}, and lone backslashes).
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

const banner = `// AUTO-GENERATED from scripts/marketing/artifact-source.html by
// scripts/marketing/generate.mjs. Do not hand-edit the strings below; edit the
// source and re-run \`node scripts/marketing/generate.mjs\`.
// CSS dark selectors were rewritten from the artifact's [data-theme] system to
// next-themes' \`.dark\` class so the site shares ONE theme with the app.
`;

writeFileSync(
  OUT,
  banner +
    "\nexport const MARKETING_CSS = `" + esc(css) + "`;\n" +
    "\nexport const MARKETING_HTML = `" + esc(html) + "`;\n",
  "utf8",
);
console.log("wrote", OUT, "| css", css.length, "| html", html.length);
