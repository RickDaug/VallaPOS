import { env } from "@/lib/env";

/**
 * Auth transactional emails (password reset) — audit R4 #2.
 *
 * Mirrors src/features/orders/email.ts: the Resend SDK is imported DYNAMICALLY so
 * it (and its transitive deps) never enter a client bundle, and RESEND_API_KEY is
 * a non-NEXT_PUBLIC var so Next never ships it client-side. No `import
 * "server-only"` — auth.ts (which calls this) is also loaded headlessly by
 * seed/smoke tooling under tsx, where that guard throws; the dynamic import keeps
 * the SDK off any client bundle regardless.
 *
 * Optional-env DEGRADE: when Resend isn't configured we DON'T throw — Better
 * Auth has already minted the token, so we log the reset URL server-side (so a
 * self-hosted/dev operator can still complete a reset) and return a typed result.
 * A password reset must never hard-fail just because email is off.
 */

/** Default sender when RESET_FROM_EMAIL / RECEIPT_FROM_EMAIL is unset. */
const DEFAULT_FROM = "VallaPOS <onboarding@resend.dev>";

export type SendAuthEmailResult =
  | { ok: true }
  | { ok: false; reason: "email_not_configured" | "send_failed" };

/** Plain-text + minimal HTML body for the reset email. `url` is the Better Auth
 * verification link (routes through /api/auth then to /reset-password?token=…). */
function renderResetEmail(url: string): { subject: string; text: string; html: string } {
  const subject = "Reset your VallaPOS password";
  const text = [
    "We received a request to reset your VallaPOS password.",
    "",
    `Reset it here: ${url}`,
    "",
    "This link expires in about an hour. If you didn't ask for a reset, you can",
    "safely ignore this email — your password won't change.",
  ].join("\n");
  const html = [
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1d23">`,
    `<h1 style="font-size:20px;font-weight:800;margin:0 0 16px">Reset your password</h1>`,
    `<p style="margin:0 0 16px">We received a request to reset your VallaPOS password.</p>`,
    `<p style="margin:0 0 24px">`,
    `<a href="${url}" style="display:inline-block;background:#1f8a8a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Reset password</a>`,
    `</p>`,
    `<p style="margin:0 0 8px;font-size:14px;color:#5b6472">Or paste this link into your browser:</p>`,
    `<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${url}">${url}</a></p>`,
    `<p style="margin:0;font-size:13px;color:#5b6472">This link expires in about an hour. If you didn't ask for a reset, you can safely ignore this email.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

/**
 * Deliver a password-reset email. Returns a typed result instead of throwing on
 * provider failure so the auth flow stays resilient.
 */
export async function sendPasswordResetEmail(
  to: string,
  url: string,
): Promise<SendAuthEmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    // Degrade, don't fail: log the link so a dev/self-hosted operator can still
    // reset. Never expose it to the client (this only runs server-side).
    console.warn(
      `[auth] Password reset requested for ${to} but Resend is not configured; ` +
        `reset link (dev only): ${url}`,
    );
    return { ok: false, reason: "email_not_configured" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const rendered = renderResetEmail(url);
    const { error } = await resend.emails.send({
      from: env.RECEIPT_FROM_EMAIL ?? DEFAULT_FROM,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    if (error) {
      console.error("Resend password-reset send failed:", error);
      return { ok: false, reason: "send_failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error("Resend password-reset send threw:", err);
    return { ok: false, reason: "send_failed" };
  }
}

/** Plain-text + minimal HTML body for the "confirm your email" message. `url` is
 * the Better Auth verification link (GET /api/auth/verify-email?token=…). */
function renderVerificationEmail(url: string): { subject: string; text: string; html: string } {
  const subject = "Confirm your VallaPOS email";
  const text = [
    "Welcome to VallaPOS! Please confirm this email address so we can send you",
    "receipts and account notices.",
    "",
    `Confirm it here: ${url}`,
    "",
    "You can keep using VallaPOS right away — confirming just verifies we can",
    "reach you. If you didn't create a VallaPOS account, you can ignore this email.",
  ].join("\n");
  const html = [
    `<div style="font-family:system-ui,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1a1d23">`,
    `<h1 style="font-size:20px;font-weight:800;margin:0 0 16px">Confirm your email</h1>`,
    `<p style="margin:0 0 16px">Welcome to VallaPOS! Confirm this address so we can send you receipts and account notices.</p>`,
    `<p style="margin:0 0 24px">`,
    `<a href="${url}" style="display:inline-block;background:#1f8a8a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Confirm email</a>`,
    `</p>`,
    `<p style="margin:0 0 8px;font-size:14px;color:#5b6472">Or paste this link into your browser:</p>`,
    `<p style="margin:0 0 24px;font-size:13px;word-break:break-all"><a href="${url}">${url}</a></p>`,
    `<p style="margin:0;font-size:13px;color:#5b6472">You can keep using VallaPOS right away — confirming just verifies we can reach you.</p>`,
    `</div>`,
  ].join("");
  return { subject, text, html };
}

/**
 * Deliver a "confirm your email" message on sign-up. Non-blocking: Better Auth is
 * configured WITHOUT requireEmailVerification, so a new owner uses VallaPOS
 * immediately whether or not this sends. Degrades exactly like the reset email —
 * when Resend isn't configured we log the link server-side and return a typed
 * result instead of throwing, so sign-up never hard-fails on email.
 */
export async function sendVerificationEmail(
  to: string,
  url: string,
): Promise<SendAuthEmailResult> {
  const apiKey = env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn(
      `[auth] Email verification requested for ${to} but Resend is not configured; ` +
        `verify link (dev only): ${url}`,
    );
    return { ok: false, reason: "email_not_configured" };
  }

  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const rendered = renderVerificationEmail(url);
    const { error } = await resend.emails.send({
      from: env.RECEIPT_FROM_EMAIL ?? DEFAULT_FROM,
      to,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    if (error) {
      console.error("Resend verification send failed:", error);
      return { ok: false, reason: "send_failed" };
    }
    return { ok: true };
  } catch (err) {
    console.error("Resend verification send threw:", err);
    return { ok: false, reason: "send_failed" };
  }
}

// Exported for unit tests (pure body rendering, no network).
export const __test = { renderResetEmail, renderVerificationEmail };
