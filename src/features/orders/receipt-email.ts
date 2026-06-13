import { formatMoney } from "@/lib/money";
import type { OrderReceipt } from "./queries";

/**
 * Pure receipt → email renderer. Kept free of `server-only` imports so it can be
 * unit tested and reused. Produces an email subject + plain-text + HTML bodies.
 */
export function renderReceiptEmail(receipt: OrderReceipt): {
  subject: string;
  text: string;
  html: string;
} {
  const money = (c: number) => formatMoney(c, receipt.currency);
  const when = new Date(receipt.createdAt).toLocaleString("en-US");
  const taxLabel = receipt.taxInclusive
    ? `Tax (incl., ${(receipt.taxRateBps / 100).toFixed(2)}%)`
    : `Tax (${(receipt.taxRateBps / 100).toFixed(2)}%)`;

  const subject = `Receipt — ${receipt.businessName} — Order #${receipt.number}`;

  const lineRowsText = receipt.lines
    .map((l) => {
      const base = `${l.quantity} x ${l.name} @ ${money(l.unitPriceCents)} = ${money(l.totalCents)}`;
      return l.discountCents > 0 ? `${base} (−${money(l.discountCents)})` : base;
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
    "",
    "Thank you!",
  ]
    .filter(Boolean)
    .join("\n");

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lineRowsHtml = receipt.lines
    .map(
      (l) =>
        `<tr><td>${l.quantity} × ${esc(l.name)}</td><td align="right">${money(l.totalCents)}</td></tr>`,
    )
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
</tfoot>
</table>
<p style="color:#666">Thank you!</p>
</body></html>`;

  return { subject, text, html };
}
