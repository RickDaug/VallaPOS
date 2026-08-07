import { describe, expect, it } from "vitest";

import { buildTrustedOrigins } from "./trusted-origins";

const BASE = {
  betterAuthUrl: "https://vallapos.com",
  appUrl: "https://vallapos.com",
};

describe("buildTrustedOrigins", () => {
  it("always trusts the configured URLs and the custom domain", () => {
    expect(buildTrustedOrigins(BASE)).toEqual([
      "https://vallapos.com",
      "https://www.vallapos.com",
    ]);
  });

  it("does NOT widen production, even when Vercel supplies deployment hosts", () => {
    const origins = buildTrustedOrigins({
      ...BASE,
      vercelEnv: "production",
      vercelBranchUrl: "valla-pos-git-main-team.vercel.app",
      vercelUrl: "valla-abc123-team.vercel.app",
    });
    expect(origins).toEqual(["https://vallapos.com", "https://www.vallapos.com"]);
    expect(origins.some((o) => o.includes("vercel.app"))).toBe(false);
  });

  it("trusts the per-branch preview host so sign-in is testable pre-production", () => {
    const origins = buildTrustedOrigins({
      ...BASE,
      vercelEnv: "preview",
      vercelBranchUrl: "valla-pos-git-chore-security-dep-bumps-team.vercel.app",
      vercelUrl: "valla-3v2qj59mc-team.vercel.app",
    });
    expect(origins).toContain(
      "https://valla-pos-git-chore-security-dep-bumps-team.vercel.app",
    );
    expect(origins).toContain("https://valla-3v2qj59mc-team.vercel.app");
  });

  it("adds the https scheme to Vercel's bare hosts", () => {
    const origins = buildTrustedOrigins({
      betterAuthUrl: undefined,
      appUrl: undefined,
      vercelEnv: "preview",
      vercelBranchUrl: "host.vercel.app",
    });
    // Better Auth compares full origins, so the bare host must gain a scheme.
    expect(origins).toContain("https://host.vercel.app");
    expect(origins).not.toContain("host.vercel.app");
  });

  it("does not double-prefix a host that already carries a scheme", () => {
    const origins = buildTrustedOrigins({
      ...BASE,
      vercelEnv: "preview",
      vercelBranchUrl: "https://host.vercel.app",
    });
    expect(origins).toContain("https://host.vercel.app");
    expect(origins.some((o) => o.includes("https://https://"))).toBe(false);
  });

  it("drops missing values and de-duplicates", () => {
    // BETTER_AUTH_URL and NEXT_PUBLIC_APP_URL are commonly the same value.
    const origins = buildTrustedOrigins({
      betterAuthUrl: "https://vallapos.com",
      appUrl: "https://vallapos.com",
      vercelEnv: "preview",
    });
    expect(origins).toEqual(["https://vallapos.com", "https://www.vallapos.com"]);
  });

  it("survives a local run where no Vercel vars exist", () => {
    expect(() => buildTrustedOrigins({ betterAuthUrl: "http://localhost:3000" })).not.toThrow();
    expect(buildTrustedOrigins({ betterAuthUrl: "http://localhost:3000" })).toContain(
      "http://localhost:3000",
    );
  });
});
