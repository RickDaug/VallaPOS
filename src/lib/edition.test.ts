import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `edition.ts` derives its constants at import time from process.env, so each
 * case resets the module registry and re-imports under a stubbed env.
 */
async function loadEdition(value?: string) {
  vi.resetModules();
  if (value === undefined) vi.stubEnv("NEXT_PUBLIC_VALLA_EDITION", "");
  else vi.stubEnv("NEXT_PUBLIC_VALLA_EDITION", value);
  return import("./edition");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("edition switch", () => {
  it("defaults to the cloud edition when the var is unset/blank", async () => {
    const e = await loadEdition();
    expect(e.EDITION).toBe("cloud");
    expect(e.isCloud).toBe(true);
    expect(e.isLocal).toBe(false);
    expect(e.authMode).toBe("session");
    expect(e.dataSource).toBe("neon");
    expect(e.isMultiTenant).toBe(true);
    expect(e.paymentsEnabled).toBe(true);
    expect(e.peripheralsEnabled).toBe(false);
    expect(e.usesCloudSession).toBe(true);
    expect(e.requiresLicenseKey).toBe(false);
  });

  it("treats any non-'local' value as cloud (no accidental local build)", async () => {
    const e = await loadEdition("Local"); // case-sensitive on purpose
    expect(e.EDITION).toBe("cloud");
    expect(e.isCloud).toBe(true);
  });

  it("selects the local edition and flips every derived flag", async () => {
    const e = await loadEdition("local");
    expect(e.EDITION).toBe("local");
    expect(e.isLocal).toBe(true);
    expect(e.isCloud).toBe(false);
    expect(e.authMode).toBe("pin-only");
    expect(e.dataSource).toBe("sqlite");
    expect(e.isMultiTenant).toBe(false);
    expect(e.paymentsEnabled).toBe(false);
    expect(e.peripheralsEnabled).toBe(true);
    expect(e.usesCloudSession).toBe(false);
    expect(e.requiresLicenseKey).toBe(true);
  });
});
