import { env } from "@/lib/env";
import type { RenderedReceiptEmail } from "./receipt-email";

/**
 * Thin Resend send wrapper. Kept separate from the server action so the action
 * stays focused on tenant/validation logic and so this provider call is the only
 * place that touches the SDK + credentials.
 *
 * NOTE: no `import "server-only"` here — RESEND_API_KEY is a non-NEXT_PUBLIC env
 * var so Next never ships it to the client, and keeping the guard off lets the
 * module be imported by node-side tooling/tests. The Resend SDK is imported
 * dynamically so it (and its transitive deps) never enter a client bundle.
 */

/** Default sender when RECEIPT_FROM_EMAIL is unset. Resend's onboarding sender
 * works without domain verification for testing; a real deployment should set a
 * verified RECEIPT_FROM_EMAIL. */
const DEFAULT_FROM = "VallaPOS Receipts <onboarding@resend.dev>";

export function isEmailConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY);
}

export type SendReceiptResult =
  | { ok: true }
  | { ok: false; reason: "email_not_configured" | "send_failed" };

/**
 * Send the rendered receipt to `to` via Resend. Returns a typed result instead
 * of throwing on provider failures so the action can map it to a user-facing
 * state. Assumes `to` is already validated and the caller has authorized access
 * to the order (tenant scoping happens in the action).
 */
export async function sendReceiptEmail(
  to: string,
  rendered: RenderedReceiptEmail,
): Promise<SendReceiptResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, reason: "email_not_configured" };

  try {
    // Dynamic import keeps the SDK out of any client bundle and off the hot path
    // when email is unconfigured.
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: env.RECEIPT_FROM_EMAIL ?? DEFAULT_FROM,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    if (error) {
      console.error("Resend receipt send failed:", error);
      return { ok: false, reason: "send_failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error("Resend receipt send threw:", err);
    return { ok: false, reason: "send_failed" };
  }
}
