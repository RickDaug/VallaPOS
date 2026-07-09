import { describe, expect, it } from "vitest";
import { buildCsp, CSP_REPORT_PATH, REPORT_TO_GROUP } from "./csp";

const NONCE = "dGVzdC1ub25jZS0xMjM0NQ=="; // arbitrary base64

describe("buildCsp", () => {
  it("puts the per-request nonce on script-src", () => {
    const csp = buildCsp(NONCE, false);
    expect(csp).toContain(`script-src`);
    expect(csp).toContain(`'nonce-${NONCE}'`);
  });

  it("uses 'strict-dynamic' so nonce'd Next bootstrap can load chunks", () => {
    expect(buildCsp(NONCE, false)).toContain("'strict-dynamic'");
  });

  it("never allows 'unsafe-inline' on scripts (that would defeat the nonce)", () => {
    const csp = buildCsp(NONCE, false);
    const scriptDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"))!;
    expect(scriptDirective).not.toContain("'unsafe-inline'");
  });

  it("does NOT allow 'unsafe-eval' in production", () => {
    expect(buildCsp(NONCE, false)).not.toContain("'unsafe-eval'");
  });

  it("allows 'unsafe-eval' only in dev (for HMR/eval tooling)", () => {
    const dev = buildCsp(NONCE, true);
    const scriptDirective = dev
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src"))!;
    expect(scriptDirective).toContain("'unsafe-eval'");
  });

  it("keeps style-src 'unsafe-inline' (inline style attrs can't be nonce'd)", () => {
    const csp = buildCsp(NONCE, false);
    const styleDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("style-src"))!;
    expect(styleDirective).toContain("'unsafe-inline'");
  });

  it("locks down framing, base-uri, objects and forms", () => {
    const csp = buildCsp(NONCE, false);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("retains violation reporting (report-uri + report-to)", () => {
    const csp = buildCsp(NONCE, false);
    expect(csp).toContain(`report-uri ${CSP_REPORT_PATH}`);
    expect(csp).toContain(`report-to ${REPORT_TO_GROUP}`);
  });

  it("allows self images with data:/blob:, self fonts, and worker blobs", () => {
    const csp = buildCsp(NONCE, false);
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it("tightens connect-src to 'self' (no blanket https:; browser only calls same-origin)", () => {
    const csp = buildCsp(NONCE, false);
    const connectDirective = csp
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("connect-src"))!;
    expect(connectDirective).toBe("connect-src 'self'");
    expect(connectDirective).not.toContain("https:");
  });
});
