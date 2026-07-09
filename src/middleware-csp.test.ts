import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The CSP middleware ships REPORT-ONLY by default (audit R4 #1) so a bad
 * nonce/strict-dynamic policy can't white-screen the register. These tests pin
 * that: the response must carry the report-only header (not the enforcing one),
 * still nonce'd + strict-dynamic, so violations report without blocking.
 */

// env is imported transitively via @/lib/csp? No — csp.ts is pure. But be safe.
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
  vi.resetModules();
});

afterEach(() => {
  process.env = snapshot;
  vi.restoreAllMocks();
});

async function run() {
  const { middleware } = await import("../middleware");
  const req = new NextRequest("https://app.example.com/dashboard");
  return middleware(req);
}

describe("CSP middleware (report-only fallback)", () => {
  it("emits Content-Security-Policy-Report-Only, NOT the enforcing header", async () => {
    const res = await run();
    expect(res.headers.get("content-security-policy-report-only")).toBeTruthy();
    expect(res.headers.get("content-security-policy")).toBeNull();
  });

  it("still carries a per-request nonce + strict-dynamic (ready to flip to enforce)", async () => {
    const res = await run();
    const csp = res.headers.get("content-security-policy-report-only")!;
    expect(csp).toContain("'nonce-");
    expect(csp).toContain("'strict-dynamic'");
  });

  it("keeps the violation reporting endpoints wired", async () => {
    const res = await run();
    const csp = res.headers.get("content-security-policy-report-only")!;
    expect(csp).toContain("report-uri /api/csp-report");
    expect(csp).toContain("report-to csp-endpoint");
  });

  it("mints a fresh nonce per request", async () => {
    const a = (await run()).headers.get("content-security-policy-report-only")!;
    const b = (await run()).headers.get("content-security-policy-report-only")!;
    const nonceOf = (csp: string) => csp.match(/'nonce-([^']+)'/)?.[1];
    expect(nonceOf(a)).toBeTruthy();
    expect(nonceOf(a)).not.toBe(nonceOf(b));
  });
});
