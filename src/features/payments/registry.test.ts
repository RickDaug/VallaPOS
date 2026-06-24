import { describe, it, expect } from "vitest";
import {
  availableProviders,
  getProviderById,
  getProviderByMethod,
  isProviderAvailable,
  listProviders,
  runtimeSupports,
  selectProvider,
} from "./registry";
import { cashProvider } from "./providers/cash";
import type { PaymentProvider } from "./provider";
import type { ProviderCapabilities } from "./types";

/** A throwaway native-only fake to exercise the runtime-filtering logic. */
function makeFakeReader(overrides: Partial<ProviderCapabilities> = {}): PaymentProvider {
  const capabilities: ProviderCapabilities = {
    supportsCardNotPresent: false,
    supportsCardPresent: true,
    supportsQr: false,
    supportsRefund: true,
    supportsPartialCapture: true,
    requiresNativeShell: true,
    ...overrides,
  };
  return {
    id: "fake-reader",
    method: "CARD",
    capabilities,
    createIntent: async () => {
      throw new Error("not implemented");
    },
    capture: async () => {
      throw new Error("not implemented");
    },
    cancel: async () => {
      throw new Error("not implemented");
    },
    status: async () => {
      throw new Error("not implemented");
    },
    refund: async () => {
      throw new Error("not implemented");
    },
  };
}

describe("registry lookups", () => {
  it("finds the cash provider by id", () => {
    expect(getProviderById("cash")).toBe(cashProvider);
  });

  it("returns undefined for an unknown id", () => {
    expect(getProviderById("nope")).toBeUndefined();
  });

  it("finds the cash provider by method", () => {
    expect(getProviderByMethod("CASH")).toBe(cashProvider);
  });

  it("returns undefined for a method with no registered provider", () => {
    // CARD/QR/MANUAL providers are designed but not yet registered in groundwork.
    expect(getProviderByMethod("CARD")).toBeUndefined();
    expect(getProviderByMethod("QR")).toBeUndefined();
    expect(getProviderByMethod("MANUAL")).toBeUndefined();
  });

  it("lists exactly the cash provider for now", () => {
    expect(listProviders()).toEqual([cashProvider]);
  });
});

describe("cash capability flags", () => {
  it("cash works on every runtime (no native shell required)", () => {
    expect(cashProvider.capabilities.requiresNativeShell).toBe(false);
    expect(isProviderAvailable(cashProvider, "web")).toBe(true);
    expect(isProviderAvailable(cashProvider, "native")).toBe(true);
  });

  it("cash advertises no card/QR rails but supports refunds", () => {
    expect(cashProvider.capabilities.supportsCardPresent).toBe(false);
    expect(cashProvider.capabilities.supportsCardNotPresent).toBe(false);
    expect(cashProvider.capabilities.supportsQr).toBe(false);
    expect(cashProvider.capabilities.supportsRefund).toBe(true);
  });
});

describe("runtime availability filtering", () => {
  it("a native-only provider is unavailable on web but available on native", () => {
    const reader = makeFakeReader();
    expect(isProviderAvailable(reader, "web")).toBe(false);
    expect(isProviderAvailable(reader, "native")).toBe(true);
  });

  it("availableProviders never includes native-only rails on web", () => {
    // The real registry has only cash today; assert the property holds for it.
    const web = availableProviders("web");
    expect(web).toContain(cashProvider);
    expect(web.every((p) => !p.capabilities.requiresNativeShell)).toBe(true);
  });

  it("runtimeSupports reflects the available set", () => {
    // Web (cash only): no card-present capability anywhere.
    expect(runtimeSupports("web", "supportsCardPresent")).toBe(false);
    // Cash supports refunds on both runtimes.
    expect(runtimeSupports("web", "supportsRefund")).toBe(true);
    expect(runtimeSupports("native", "supportsRefund")).toBe(true);
  });
});

describe("selectProvider", () => {
  it("selects cash for the CASH method on web and native", () => {
    expect(selectProvider("CASH", "web")).toBe(cashProvider);
    expect(selectProvider("CASH", "native")).toBe(cashProvider);
  });

  it("returns undefined for a method with no provider", () => {
    expect(selectProvider("CARD", "web")).toBeUndefined();
    expect(selectProvider("QR", "native")).toBeUndefined();
  });
});

describe("cash provider behavior (reference of the live cash path)", () => {
  it("captures immediately and computes change like the live action", async () => {
    const intent = await cashProvider.createIntent({
      businessId: "b1",
      clientUuid: "11111111-1111-1111-1111-111111111111",
      amount: { amountCents: 1083, currency: "USD" },
      cashTenderedCents: 2000,
    });
    expect(intent.status).toBe("captured");
    expect(intent.changeCents).toBe(917);
    expect(intent.processorRef).toBeNull();
    expect(intent.nextAction).toEqual({ type: "none" });
  });

  it("rejects underpayment (mirrors the 'less than the total' guard)", async () => {
    await expect(
      cashProvider.createIntent({
        businessId: "b1",
        clientUuid: "22222222-2222-2222-2222-222222222222",
        amount: { amountCents: 1083, currency: "USD" },
        cashTenderedCents: 1000,
      }),
    ).rejects.toThrow(/less than the total/i);
  });

  it("defaults tendered to exact amount (zero change) when none given", async () => {
    const intent = await cashProvider.createIntent({
      businessId: "b1",
      clientUuid: "33333333-3333-3333-3333-333333333333",
      amount: { amountCents: 500, currency: "USD" },
    });
    expect(intent.changeCents).toBe(0);
  });
});
