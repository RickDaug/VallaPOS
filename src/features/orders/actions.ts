"use server";

import { requireMembership } from "@/lib/tenant";
import { getOrderReceipt } from "./queries";
import { renderReceiptEmail } from "./receipt-email";
import { emailReceiptSchema, type EmailReceiptInput } from "./schema";

export type EmailReceiptResult =
  | { ok: true }
  | { ok: false; reason: "email_not_configured" | "order_not_found" };

/**
 * Email a receipt to a customer.
 *
 * This is a SAFE scaffold: it validates input, gates on membership (tenant
 * isolation), loads the order strictly scoped to the business, and renders the
 * receipt to both plain text and HTML — but it does NOT bundle an email SDK or
 * ship any credentials. If no email provider is configured (no RESEND_API_KEY),
 * it returns `{ ok: false, reason: "email_not_configured" }` so the UI can show
 * a clear "coming soon" affordance instead of a broken button.
 *
 * TODO(email-provider): wire a provider here. Suggested: Resend.
 *   1. `npm install resend@<pinned-exact-version>` and commit the lockfile.
 *   2. Add `RESEND_API_KEY` (+ optional `RECEIPT_FROM_EMAIL`) to `src/lib/env.ts`
 *      as OPTIONAL vars and document them in `.env.example` (already done).
 *   3. Replace the `email_not_configured` short-circuit below with:
 *        const { Resend } = await import("resend");
 *        const resend = new Resend(process.env.RESEND_API_KEY);
 *        await resend.emails.send({
 *          from: process.env.RECEIPT_FROM_EMAIL ?? "receipts@yourdomain",
 *          to: data.email, subject, text, html,
 *        });
 *   Keep the membership gate + business-scoped load exactly as-is.
 */
export async function emailReceipt(input: EmailReceiptInput): Promise<EmailReceiptResult> {
  const data = emailReceiptSchema.parse(input);

  // Tenant isolation: only a member of this business may email its receipts.
  await requireMembership(data.businessId);

  // Business-scoped read — an orderId from another tenant returns null.
  const receipt = await getOrderReceipt(data.businessId, data.orderId);
  if (!receipt) return { ok: false, reason: "order_not_found" };

  // Render now so a future provider wiring is a one-liner (and so this code is
  // exercised/tested even while sending is disabled).
  const { subject, text, html } = renderReceiptEmail(receipt);
  void subject;
  void text;
  void html;

  // No provider configured → no-op. Do NOT pretend the email was sent.
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, reason: "email_not_configured" };
  }

  // Unreachable until a provider is wired above (see TODO). Returning the
  // not-configured result keeps the type honest without shipping a fake send.
  return { ok: false, reason: "email_not_configured" };
}
