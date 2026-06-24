import { describe, it, expect, beforeEach, vi } from "vitest";
import type { RenderedReceiptEmail } from "./receipt-email";

// env.ts throws without a full environment, so mock it. We flip RESEND_API_KEY /
// RECEIPT_FROM_EMAIL per-test via this mutable object. `vi.hoisted` lets the
// hoisted vi.mock factory reference it safely.
const fakeEnv = vi.hoisted(
  () => ({}) as { RESEND_API_KEY?: string; RECEIPT_FROM_EMAIL?: string },
);
vi.mock("@/lib/env", () => ({ env: fakeEnv }));

// Mock the Resend SDK so no network/credentials are involved.
const send = vi.hoisted(() => vi.fn());
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: (...a: unknown[]) => send(...a) };
  },
}));

import { isEmailConfigured, sendReceiptEmail } from "./email";

const rendered: RenderedReceiptEmail = {
  subject: "Receipt — Taco Stand — Order #7",
  text: "Total: $10.83",
  html: "<p>Total: $10.83</p>",
};

beforeEach(() => {
  vi.clearAllMocks();
  delete fakeEnv.RESEND_API_KEY;
  delete fakeEnv.RECEIPT_FROM_EMAIL;
  send.mockResolvedValue({ data: { id: "email_1" }, error: null });
});

describe("isEmailConfigured", () => {
  it("is false without a key, true with one", () => {
    expect(isEmailConfigured()).toBe(false);
    fakeEnv.RESEND_API_KEY = "re_test";
    expect(isEmailConfigured()).toBe(true);
  });
});

describe("sendReceiptEmail", () => {
  it("degrades to email_not_configured (no send) when the key is unset", async () => {
    const res = await sendReceiptEmail("a@b.com", rendered);
    expect(res).toEqual({ ok: false, reason: "email_not_configured" });
    expect(send).not.toHaveBeenCalled();
  });

  it("sends via Resend with the rendered bodies and the default sender", async () => {
    fakeEnv.RESEND_API_KEY = "re_test";
    const res = await sendReceiptEmail("a@b.com", rendered);
    expect(res).toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(1);
    const arg = send.mock.calls[0]![0];
    expect(arg).toMatchObject({
      to: "a@b.com",
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
    expect(arg.from).toContain("onboarding@resend.dev");
  });

  it("uses RECEIPT_FROM_EMAIL when set", async () => {
    fakeEnv.RESEND_API_KEY = "re_test";
    fakeEnv.RECEIPT_FROM_EMAIL = "receipts@mystore.com";
    await sendReceiptEmail("a@b.com", rendered);
    expect(send.mock.calls[0]![0].from).toBe("receipts@mystore.com");
  });

  it("maps a provider error to send_failed", async () => {
    fakeEnv.RESEND_API_KEY = "re_test";
    send.mockResolvedValue({ data: null, error: { message: "rate limited" } });
    const res = await sendReceiptEmail("a@b.com", rendered);
    expect(res).toEqual({ ok: false, reason: "send_failed" });
  });

  it("maps a thrown error to send_failed", async () => {
    fakeEnv.RESEND_API_KEY = "re_test";
    send.mockRejectedValue(new Error("boom"));
    const res = await sendReceiptEmail("a@b.com", rendered);
    expect(res).toEqual({ ok: false, reason: "send_failed" });
  });
});
