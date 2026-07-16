/**
 * Turn a merchant's static pay handle (`menu.qrPay.value`) into an actionable
 * pay affordance for the customer's own phone.
 *
 * The customer is holding the ONLY phone, so a QR on their screen is useless as
 * the primary action — they can't scan their own display. Instead we detect
 * whether the handle is something we can OPEN (a URL / app deep link) vs. a bare
 * handle/key the customer must copy into their payment app.
 *
 * Pure + framework-free so it's unit-testable and shared with the confirmation UI.
 */

export interface PayAction {
  /** `link` = openable via <a href>; `handle` = show + copy-to-clipboard. */
  kind: "link" | "handle";
  /** Present when kind === "link": the href to open (the raw handle value). */
  href?: string;
  /** Human-readable text to show (cleaned URL, or the raw handle to copy). */
  display: string;
  /** True for http(s) links that should open in a new tab. App deep links (venmo://, upi://, mailto:) switch apps in place. */
  external: boolean;
}

// A scheme followed by "//" — https://, http://, venmo://, upi://, pix://, etc.
const SCHEME_WITH_SLASHES = /^[a-z][a-z0-9+.-]*:\/\//i;
// Schemes that legitimately omit the "//" but are still openable (app/protocol links).
const KNOWN_NOSLASH_SCHEMES = ["mailto:", "tel:", "upi:", "pix:", "bitcoin:"];

function isOpenableLink(value: string): boolean {
  if (SCHEME_WITH_SLASHES.test(value)) return true;
  const lower = value.toLowerCase();
  return KNOWN_NOSLASH_SCHEMES.some((s) => lower.startsWith(s));
}

/** Strip the http(s):// scheme and any trailing slash for a tidier display string. */
function prettyUrl(value: string): string {
  return value.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/**
 * Classify a pay handle for the customer-facing pay CTA. The button/instruction
 * label (e.g. "Venmo", "PIX") is chosen by the caller from `menu.qrPay.label`;
 * this helper only decides HOW to act on the handle and what to display.
 *
 * @param value the merchant's raw pay handle (URL, deep link, or bare key)
 */
export function parsePayHandle(value: string): PayAction {
  const trimmed = value.trim();

  if (trimmed && isOpenableLink(trimmed)) {
    const external = /^https?:\/\//i.test(trimmed);
    return {
      kind: "link",
      href: trimmed,
      display: external ? prettyUrl(trimmed) : trimmed,
      external,
    };
  }

  return { kind: "handle", display: trimmed, external: false };
}
