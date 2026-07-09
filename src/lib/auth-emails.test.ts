import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Provide the required env so importing auth-emails (→ env) doesn't throw.
const VALID_ENV = {
  DATABASE_URL: "postgres://user:pass@host:5432/db",
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://app.example.com",
  NEXT_PUBLIC_APP_URL: "https://app.example.com",
};

let snapshot: NodeJS.ProcessEnv;

beforeEach(() => {
  snapshot = { ...process.env };
  Object.assign(process.env, VALID_ENV);
  delete process.env.RESEND_API_KEY;
  vi.resetModules();
});

afterEach(() => {
  process.env = snapshot;
  vi.restoreAllMocks();
});

async function load() {
  return await import("./auth-emails");
}

describe("renderResetEmail", () => {
  const URL = "https://app.example.com/api/auth/reset-password/tok123?callbackURL=%2Freset-password";

  it("embeds the reset URL in both the text and html bodies", async () => {
    const { __test } = await load();
    const { subject, text, html } = __test.renderResetEmail(URL);
    expect(subject.toLowerCase()).toContain("reset");
    expect(text).toContain(URL);
    expect(html).toContain(URL);
  });

  it("mentions the expiry so a stale link isn't confusing", async () => {
    const { __test } = await load();
    expect(__test.renderResetEmail(URL).text.toLowerCase()).toContain("expire");
  });
});

describe("sendPasswordResetEmail — degrades when Resend is unconfigured", () => {
  it("returns email_not_configured (never throws) and logs the link", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { sendPasswordResetEmail } = await load();
    const result = await sendPasswordResetEmail("owner@shop.test", "https://app.example.com/x");
    expect(result).toEqual({ ok: false, reason: "email_not_configured" });
    expect(warn).toHaveBeenCalled();
  });
});
