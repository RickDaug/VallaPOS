import "server-only";

import { env } from "@/lib/env";
import { renderLicenseEmail } from "./email";
import type { DeliverLicenseFn } from "./webhook";

/**
 * Real delivery via Resend. Degrades gracefully: when `RESEND_API_KEY` is unset it
 * logs and skips (the buyer can still retrieve the key on the success page), so a
 * missing email provider never fails the paid webhook.
 */
export const resendLicenseDelivery: DeliverLicenseFn = async ({ email, licenseKey, downloadUrl }) => {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      "RESEND_API_KEY unset — desktop license email NOT sent; buyer retrieves the key on the success page.",
    );
    return;
  }
  const { subject, html, text } = renderLicenseEmail({ licenseKey, downloadUrl });
  const { Resend } = await import("resend");
  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: env.RECEIPT_FROM_EMAIL ?? "VallaPOS <onboarding@resend.dev>",
    to: email,
    subject,
    html,
    text,
  });
};
