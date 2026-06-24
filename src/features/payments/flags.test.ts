import { describe, it, expect } from "vitest";
import { isPaymentsV2Enabled, PAYMENTS_V2_DEFAULT_ENABLED } from "./flags";

describe("payments v2 feature flag", () => {
  it("ships OFF by default", () => {
    expect(PAYMENTS_V2_DEFAULT_ENABLED).toBe(false);
  });

  it("is OFF when the env var is unset", () => {
    expect(isPaymentsV2Enabled({})).toBe(false);
  });

  it("is ON only for explicit truthy strings", () => {
    expect(isPaymentsV2Enabled({ PAYMENTS_V2_ENABLED: "true" })).toBe(true);
    expect(isPaymentsV2Enabled({ PAYMENTS_V2_ENABLED: "1" })).toBe(true);
  });

  it("treats any other value as OFF", () => {
    expect(isPaymentsV2Enabled({ PAYMENTS_V2_ENABLED: "false" })).toBe(false);
    expect(isPaymentsV2Enabled({ PAYMENTS_V2_ENABLED: "0" })).toBe(false);
    expect(isPaymentsV2Enabled({ PAYMENTS_V2_ENABLED: "yes" })).toBe(false);
    expect(isPaymentsV2Enabled({ PAYMENTS_V2_ENABLED: "" })).toBe(false);
  });
});
