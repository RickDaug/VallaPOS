/**
 * CSP violation report sink (R-5).
 *
 * The app ships a `Content-Security-Policy-Report-Only` header (see
 * `next.config.ts`) wired to POST violations here via `report-uri` / `report-to`.
 * This endpoint exists so we actually COLLECT violations before any future flip
 * to enforce mode — it never blocks and never enforces anything.
 *
 * Contract:
 *  - POST only (the directive only ever POSTs); other verbs get 405.
 *  - No auth: the browser sends these unauthenticated, cross-context. We must
 *    accept them without a session and must not trust the body.
 *  - Cheap + safe: parse defensively, log a compact summary server-side, and
 *    always answer `204 No Content`. Never echo the body back (no reflection,
 *    no leak). Body size is capped so a flood can't blow up the function.
 *  - Accepts both legacy `application/csp-report` (single object under
 *    `csp-report`) and the newer Reporting API `application/reports+json`
 *    (an array of report objects).
 */

export const runtime = "nodejs";
// Reports are fire-and-forget telemetry; never cache.
export const dynamic = "force-dynamic";

/** Cap the body we'll read so a malicious flood can't exhaust the function. */
const MAX_BYTES = 16 * 1024;

interface NormalizedReport {
  documentUri?: string;
  violatedDirective?: string;
  blockedUri?: string;
  effectiveDirective?: string;
}

/** Best-effort pull of the few fields worth logging, across both report shapes. */
function normalize(body: unknown): NormalizedReport[] {
  if (body == null || typeof body !== "object") return [];

  // Legacy: { "csp-report": { "document-uri": ..., "violated-directive": ... } }
  const legacy = (body as Record<string, unknown>)["csp-report"];
  if (legacy && typeof legacy === "object") {
    const r = legacy as Record<string, unknown>;
    return [
      {
        documentUri: str(r["document-uri"]),
        violatedDirective: str(r["violated-directive"]),
        effectiveDirective: str(r["effective-directive"]),
        blockedUri: str(r["blocked-uri"]),
      },
    ];
  }

  // Reporting API: [ { type: "csp-violation", body: { documentURL, ... } }, ... ]
  if (Array.isArray(body)) {
    return body
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .map((item) => {
        const inner = (item.body && typeof item.body === "object" ? item.body : {}) as Record<
          string,
          unknown
        >;
        return {
          documentUri: str(inner.documentURL),
          effectiveDirective: str(inner.effectiveDirective),
          blockedUri: str(inner.blockedURL),
          violatedDirective: str(inner.effectiveDirective),
        };
      });
  }

  return [];
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const raw = await request.text();
    if (raw.length > MAX_BYTES) {
      // Too big to be a real report — drop it without parsing.
      return new Response(null, { status: 204 });
    }

    let body: unknown;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      // Unparseable body — accept-and-ignore (still 204, never 4xx-noisy).
      return new Response(null, { status: 204 });
    }

    const reports = normalize(body);
    for (const r of reports) {
      // Compact, non-reflected server log line. No request headers, no auth,
      // no echo to the client — just enough to triage before an enforce flip.
      console.warn(
        "[csp-report]",
        JSON.stringify({
          directive: r.effectiveDirective ?? r.violatedDirective,
          blocked: r.blockedUri,
          document: r.documentUri,
        }),
      );
    }
  } catch {
    // Never let a report sink throw; it must be invisible to the browser.
  }
  return new Response(null, { status: 204 });
}

/** Any non-POST verb is meaningless here. */
export function GET(): Response {
  return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
