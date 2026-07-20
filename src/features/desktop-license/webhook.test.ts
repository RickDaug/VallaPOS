import { describe, expect, it } from "vitest";
import type { SignFn } from "@/lib/license/license";
import { DESKTOP_SKU } from "./issue-service";
import type { CreateLicenseInput, DesktopLicenseStore, LicenseRecord } from "./store";
import { type DeliverLicenseFn, extractDesktopPurchase, processDesktopWebhook } from "./webhook";

function fakeStore() {
  const rows: LicenseRecord[] = [];
  const store: DesktopLicenseStore = {
    async findByStripeSession(sid) {
      return rows.find((r) => r.stripeSessionId === sid) ?? null;
    },
    async create(input: CreateLicenseInput) {
      const existing = rows.find((r) => r.stripeSessionId === input.stripeSessionId);
      if (existing) return existing;
      const rec: LicenseRecord = { id: `lic_${rows.length + 1}`, status: "ACTIVE", ...input };
      rows.push(rec);
      return rec;
    },
  };
  return { store, rows };
}

const fakeSign: SignFn = () => new Uint8Array(64);
const IAT = 1_752_960_000_000;

function paidEvent(
  overrides: Record<string, unknown> = {},
): { type: string; object: Record<string, unknown> } {
  return {
    type: "checkout.session.completed",
    object: {
      id: "cs_test_1",
      payment_status: "paid",
      metadata: { sku: DESKTOP_SKU },
      customer_details: { email: "buyer@example.com" },
      ...overrides,
    },
  };
}

describe("extractDesktopPurchase", () => {
  it("accepts a paid, sku-tagged session with an email", () => {
    expect(extractDesktopPurchase(paidEvent())).toEqual({
      stripeSessionId: "cs_test_1",
      email: "buyer@example.com",
    });
  });

  it("falls back to customer_email when customer_details has none", () => {
    const e = paidEvent({ customer_details: null, customer_email: "alt@example.com" });
    expect(extractDesktopPurchase(e)?.email).toBe("alt@example.com");
  });

  it("ignores anything that isn't our paid desktop purchase", () => {
    expect(extractDesktopPurchase({ type: "payment_intent.succeeded", object: {} })).toBeNull();
    expect(extractDesktopPurchase(paidEvent({ payment_status: "unpaid" }))).toBeNull();
    expect(extractDesktopPurchase(paidEvent({ metadata: { sku: "something-else" } }))).toBeNull();
    expect(extractDesktopPurchase(paidEvent({ metadata: null }))).toBeNull();
    expect(
      extractDesktopPurchase(paidEvent({ customer_details: null, customer_email: null })),
    ).toBeNull();
  });
});

describe("processDesktopWebhook", () => {
  it("issues + delivers on a new paid purchase", async () => {
    const { store, rows } = fakeStore();
    const delivered: Array<{ email: string; licenseKey: string; downloadUrl: string }> = [];
    const deliver: DeliverLicenseFn = async (i) => {
      delivered.push(i);
    };
    const res = await processDesktopWebhook(paidEvent(), {
      sign: fakeSign,
      store,
      deliver,
      now: IAT,
      downloadUrl: "https://dl/vallapos",
    });

    expect(res).toEqual({ handled: true, newlyIssued: true });
    expect(rows).toHaveLength(1);
    expect(delivered).toEqual([
      { email: "buyer@example.com", licenseKey: rows[0]!.licenseKey, downloadUrl: "https://dl/vallapos" },
    ]);
  });

  it("does NOT re-issue or re-email a re-delivered event (idempotent)", async () => {
    const { store, rows } = fakeStore();
    let deliveries = 0;
    const deliver: DeliverLicenseFn = async () => {
      deliveries += 1;
    };
    const deps = { sign: fakeSign, store, deliver, downloadUrl: "https://dl" };
    await processDesktopWebhook(paidEvent(), { ...deps, now: IAT });
    const again = await processDesktopWebhook(paidEvent(), { ...deps, now: IAT + 9000 });

    expect(again).toEqual({ handled: true, newlyIssued: false });
    expect(rows).toHaveLength(1);
    expect(deliveries).toBe(1);
  });

  it("ignores an event that isn't our paid purchase — no write, no email", async () => {
    const { store, rows } = fakeStore();
    let deliveries = 0;
    const res = await processDesktopWebhook(
      { type: "checkout.session.completed", object: { id: "cs", payment_status: "unpaid" } },
      { sign: fakeSign, store, deliver: async () => void (deliveries += 1), now: IAT, downloadUrl: "x" },
    );
    expect(res).toEqual({ handled: false, newlyIssued: false });
    expect(rows).toHaveLength(0);
    expect(deliveries).toBe(0);
  });
});
