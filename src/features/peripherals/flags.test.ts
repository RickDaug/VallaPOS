import { describe, it, expect } from "vitest";
import { isPeripheralsV2Enabled, PERIPHERALS_V2_DEFAULT_ENABLED } from "./flags";

describe("peripherals v2 feature flag", () => {
  it("ships OFF by default", () => {
    expect(PERIPHERALS_V2_DEFAULT_ENABLED).toBe(false);
  });

  it("is OFF when the env var is unset", () => {
    expect(isPeripheralsV2Enabled({})).toBe(false);
  });

  it("is ON only for explicit truthy strings", () => {
    expect(isPeripheralsV2Enabled({ PERIPHERALS_V2_ENABLED: "true" })).toBe(true);
    expect(isPeripheralsV2Enabled({ PERIPHERALS_V2_ENABLED: "1" })).toBe(true);
  });

  it("treats any other value as OFF", () => {
    expect(isPeripheralsV2Enabled({ PERIPHERALS_V2_ENABLED: "false" })).toBe(false);
    expect(isPeripheralsV2Enabled({ PERIPHERALS_V2_ENABLED: "0" })).toBe(false);
    expect(isPeripheralsV2Enabled({ PERIPHERALS_V2_ENABLED: "yes" })).toBe(false);
    expect(isPeripheralsV2Enabled({ PERIPHERALS_V2_ENABLED: "" })).toBe(false);
  });
});
