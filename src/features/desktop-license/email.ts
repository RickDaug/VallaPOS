/**
 * Pure license-delivery email renderer — no env, no Resend, no `server-only` — so
 * it's unit-testable (the env-touching sender lives in `delivery.ts`).
 */
export interface LicenseEmail {
  subject: string;
  html: string;
  text: string;
}

const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

export function renderLicenseEmail(input: { licenseKey: string; downloadUrl: string }): LicenseEmail {
  const key = escapeHtml(input.licenseKey);
  const url = escapeHtml(input.downloadUrl);
  return {
    subject: "Your VallaPOS Desktop license",
    text:
      `Thanks for buying VallaPOS Desktop (Offline) — it's yours to keep.\n\n` +
      `1. Download the app: ${input.downloadUrl}\n` +
      `2. Open it and paste this license key when prompted:\n\n${input.licenseKey}\n\n` +
      `Keep this key safe — it unlocks the app on your device, forever.`,
    html:
      `<p>Thanks for buying <strong>VallaPOS Desktop (Offline)</strong> — it's yours to keep.</p>` +
      `<p><strong>1.</strong> <a href="${url}">Download the app</a></p>` +
      `<p><strong>2.</strong> Open it and paste this license key when prompted:</p>` +
      `<pre style="white-space:pre-wrap;word-break:break-all;background:#f4f4f5;padding:12px;border-radius:8px">${key}</pre>` +
      `<p style="color:#666">Keep this key safe — it unlocks the app on your device, forever.</p>`,
  };
}
