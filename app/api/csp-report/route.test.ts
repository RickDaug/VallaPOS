import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

/**
 * CSP report sink (R-5). It must accept the browser's unauthenticated POST,
 * never throw, never reflect the body, and always answer 204 — while logging a
 * compact, non-sensitive summary server-side. GET (and other verbs) are 405.
 */
function makePost(body: string, contentType = "application/csp-report"): Request {
  return new Request("http://localhost/api/csp-report", {
    method: "POST",
    headers: { "content-type": contentType },
    body,
  });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/csp-report", () => {
  it("accepts a legacy csp-report body and returns 204 with no reflected body", async () => {
    const res = await POST(
      makePost(
        JSON.stringify({
          "csp-report": {
            "document-uri": "https://app.example.com/x",
            "violated-directive": "script-src",
            "blocked-uri": "https://evil.example.com/a.js",
          },
        }),
      ),
    );
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
    expect(console.warn).toHaveBeenCalledWith("[csp-report]", expect.stringContaining("script-src"));
  });

  it("accepts the Reporting API array shape", async () => {
    const res = await POST(
      makePost(
        JSON.stringify([
          {
            type: "csp-violation",
            body: {
              documentURL: "https://app.example.com/y",
              effectiveDirective: "img-src",
              blockedURL: "https://evil.example.com/p.png",
            },
          },
        ]),
        "application/reports+json",
      ),
    );
    expect(res.status).toBe(204);
    expect(console.warn).toHaveBeenCalledWith("[csp-report]", expect.stringContaining("img-src"));
  });

  it("returns 204 on an unparseable body without throwing", async () => {
    const res = await POST(makePost("}{ not json"));
    expect(res.status).toBe(204);
  });

  it("returns 204 on an empty body", async () => {
    const res = await POST(makePost(""));
    expect(res.status).toBe(204);
  });

  it("ignores an oversized body without parsing it", async () => {
    const huge = "x".repeat(20 * 1024);
    const res = await POST(makePost(huge));
    expect(res.status).toBe(204);
    // Oversized => dropped before parse => nothing logged.
    expect(console.warn).not.toHaveBeenCalled();
  });
});

describe("GET /api/csp-report", () => {
  it("rejects non-POST verbs with 405", () => {
    const res = GET();
    expect(res.status).toBe(405);
    expect(res.headers.get("Allow")).toBe("POST");
  });
});
