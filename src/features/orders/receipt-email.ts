import { z } from "zod";
import { formatMoney } from "@/lib/money";
import { paymentMethodLabel } from "./payment-method";
import type { OrderReceipt } from "./queries";

/**
 * Pure receipt → email rendering + recipient validation. Deliberately free of
 * any `server-only` import so it can be unit tested and reused without a network
 * or DB. The server action (actions.ts) calls these, then hands the rendered
 * bodies to the Resend SDK.
 */

/**
 * Validate (and normalize) a recipient email address with zod. Returns the
 * trimmed, lowercased address on success or null when invalid — callers use the
 * null to short-circuit to the `invalid_email` result without throwing.
 */
const recipientEmailSchema = z.string().trim().toLowerCase().email();

export function validateRecipientEmail(raw: unknown): string | null {
  const parsed = recipientEmailSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export interface RenderedReceiptEmail {
  subject: string;
  text: string;
  html: string;
}

export function renderReceiptEmail(receipt: OrderReceipt): RenderedReceiptEmail {
  const money = (c: number) => formatMoney(c, receipt.currency);
  const when = new Date(receipt.createdAt).toLocaleString("en-US");
  const taxLabel = receipt.taxInclusive
    ? `Tax (incl., ${(receipt.taxRateBps / 100).toFixed(2)}%)`
    : `Tax (${(receipt.taxRateBps / 100).toFixed(2)}%)`;

  // Positive payments are what the customer actually paid; refund reversals are
  // negative rows we don't surface as "Paid" lines on the receipt.
  const paidLines = receipt.payments.filter((p) => p.amountCents > 0);
  const paymentLabel =
    paidLines.length > 0
      ? paidLines.map((p) => paymentMethodLabel(p.method)).join(", ")
      : null;

  const subject = `Receipt — ${receipt.businessName} — Order #${receipt.number}`;

  // ── Plain-text body ────────────────────────────────────────────────────────
  const lineRowsText = receipt.lines
    .map((l) => {
      const base = `${l.quantity} x ${l.name} @ ${money(l.unitPriceCents)} = ${money(l.totalCents)}`;
      const withDiscount = l.discountCents > 0 ? `${base} (−${money(l.discountCents)})` : base;
      if (l.modifiers.length === 0) return withDiscount;
      const mods = l.modifiers
        .map((m) => `    + ${m.name}${m.priceDeltaCents !== 0 ? ` (${money(m.priceDeltaCents)})` : ""}`)
        .join("\n");
      return `${withDiscount}\n${mods}`;
    })
    .join("\n");

  const text = [
    receipt.businessName,
    `Order #${receipt.number}`,
    when,
    receipt.customerName ? `Customer: ${receipt.customerName}` : null,
    "",
    lineRowsText,
    "",
    `Subtotal: ${money(receipt.subtotalCents)}`,
    receipt.discountCents > 0 ? `Discount: −${money(receipt.discountCents)}` : null,
    `${taxLabel}: ${money(receipt.taxCents)}`,
    receipt.tipCents > 0 ? `Tip: ${money(receipt.tipCents)}` : null,
    `Total: ${money(receipt.totalCents)}`,
    paymentLabel ? `Paid: ${paymentLabel}` : null,
    "",
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n");

  // ── HTML body ──────────────────────────────────────────────────────────────
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lineRowsHtml = receipt.lines
    .map((l) => {
      const main = `<tr><td>${l.quantity} × ${esc(l.name)}</td><td align="right">${money(l.totalCents)}</td></tr>`;
      if (l.modifiers.length === 0) return main;
      const mods = l.modifiers
        .map(
          (m) =>
            `<tr><td style="padding-left:16px;color:#666;font-size:13px">+ ${esc(m.name)}${
              m.priceDeltaCents !== 0 ? ` (${money(m.priceDeltaCents)})` : ""
            }</td><td></td></tr>`,
        )
        .join("");
      return main + mods;
    })
    .join("");

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;max-width:480px;margin:auto">
<h2 style="margin-bottom:0">${esc(receipt.businessName)}</h2>
<p style="color:#666;margin-top:4px">Order #${receipt.number} · ${esc(when)}${
    receipt.customerName ? ` · ${esc(receipt.customerName)}` : ""
  }</p>
<table style="width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums">
<tbody>${lineRowsHtml}</tbody>
<tfoot style="border-top:1px solid #ddd">
<tr><td>Subtotal</td><td align="right">${money(receipt.subtotalCents)}</td></tr>
${receipt.discountCents > 0 ? `<tr><td>Discount</td><td align="right">−${money(receipt.discountCents)}</td></tr>` : ""}
<tr><td>${esc(taxLabel)}</td><td align="right">${money(receipt.taxCents)}</td></tr>
${receipt.tipCents > 0 ? `<tr><td>Tip</td><td align="right">${money(receipt.tipCents)}</td></tr>` : ""}
<tr><td><strong>Total</strong></td><td align="right"><strong>${money(receipt.totalCents)}</strong></td></tr>
${paymentLabel ? `<tr><td style="color:#666">Paid · ${esc(paymentLabel)}</td><td></td></tr>` : ""}
</tfoot>
</table>
<p style="color:#666">Thank you!</p>
</body></html>`;

  return { subject, text, html };
}
