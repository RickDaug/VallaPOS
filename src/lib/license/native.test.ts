import { describe, expect, it } from "vitest";
import { isTauriRuntime, nativeCheckLicense, toLicenseErrorCode } from "./native";

describe("toLicenseErrorCode", () => {
  it("passes through the known Rust error codes", () => {
    for (const code of [
      "malformed",
      "bad_signature",
      "unsupported_version",
      "expired",
      "revoked",
    ] as const) {
      expect(toLicenseErrorCode(code)).toBe(code);
    }
  });

  it("fails closed to 'malformed' for anything unexpected", () => {
    expect(toLicenseErrorCode("nonsense")).toBe("malformed");
    expect(toLicenseErrorCode(new Error("boom"))).toBe("malformed");
    expect(toLicenseErrorCode(undefined)).toBe("malformed");
    expect(toLicenseErrorCode(42)).toBe("malformed");
  });
});

describe("isTauriRuntime", () => {
  it("is false outside the Tauri webview (no __TAURI_INTERNALS__)", () => {
    expect(isTauriRuntime()).toBe(false);
  });
});

describe("nativeCheckLicense", () => {
  it("reports 'unlicensed' when no blob is stored (never touches Tauri)", async () => {
    expect(await nativeCheckLicense(null, 1_000)).toEqual({ ok: false, reason: "unlicensed" });
    expect(await nativeCheckLicense("", 1_000)).toEqual({ ok: false, reason: "unlicensed" });
  });

  it("reports 'unavailable' when a blob exists but not under Tauri", async () => {
    // Guards the dynamic @tauri-apps/api/core import behind the runtime check, so
    // this resolves without Tauri present.
    expect(await nativeCheckLicense("SOME-BLOB", 1_000)).toEqual({
      ok: false,
      reason: "unavailable",
    });
  });
});
