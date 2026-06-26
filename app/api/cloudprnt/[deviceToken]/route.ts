/**
 * Star CloudPRNT polling endpoint — the printer talks to THIS.
 *
 *   POST|GET /api/cloudprnt/<deviceToken>?businessId=<id>   → POLL
 *     The printer asks "any work?". We reply `{ jobReady, mediaTypes }`. Star's
 *     real firmware POSTs a JSON status body; we accept GET too for simple
 *     pollers / our simulator. 200 either way.
 *
 *   GET /api/cloudprnt/<deviceToken>?businessId=<id>&type=<mediaType>  → JOB BODY
 *     When a job is ready the printer fetches the body — we serve the raw ESC/POS
 *     bytes with the right `Content-Type`. (Star distinguishes the body GET from
 *     the poll by the `Accept`/media type; here a `type` query param OR an
 *     `Accept` that names our media type selects the body. The poll is the GET
 *     default.) 200 with bytes, or 200 no-job when empty.
 *
 *   DELETE /api/cloudprnt/<deviceToken>?businessId=<id>&token=<jobId>  → CONFIRM
 *     The printer confirms it printed; we DEQUEUE that job. A failed print simply
 *     never DELETEs, so the job is re-served next poll (at-least-once).
 *
 * AUTH: none in the user-session sense — printers can't sign in. The opaque,
 * per-device `deviceToken` IS the credential; jobs are scoped by
 * `(businessId, deviceToken)`, so a wrong/foreign token sees an empty queue. The
 * handler is intentionally defensive + cheap (no DB, no session, bounded work).
 *
 * The queue store is the in-memory singleton (`getCloudPrntStore`) — ⚠ NOT durable
 * on serverless (see `cloudprnt.ts`). Production swaps in an Upstash/DB store.
 */

import {
  buildPollResponse,
  confirmJob,
  getJobBody,
  STAR_ESCPOS_MEDIA_TYPE,
  SUPPORTED_MEDIA_TYPES,
  type QueueKey,
} from "@/features/peripherals/cloudprnt";
import { getCloudPrntStore } from "@/features/peripherals/cloudprnt-store";

// Polling is inherently dynamic + stateful; never cache, run on Node.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ deviceToken: string }> };

/** Resolve + validate the `(businessId, deviceToken)` scope, or null if invalid. */
function resolveKey(request: Request, deviceToken: string): QueueKey | null {
  const businessId = new URL(request.url).searchParams.get("businessId")?.trim();
  const token = deviceToken?.trim();
  if (!businessId || !token) return null;
  // Cheap sanity caps so a junk token can't be used to fan out memory/log noise.
  if (businessId.length > 200 || token.length > 200) return null;
  return { businessId, deviceToken: token };
}

/** True when this GET is asking for the job BODY rather than polling. */
function wantsJobBody(request: Request): boolean {
  const url = new URL(request.url);
  const type = url.searchParams.get("type");
  if (type && SUPPORTED_MEDIA_TYPES.includes(type as (typeof SUPPORTED_MEDIA_TYPES)[number])) {
    return true;
  }
  // Star fetches the body with an Accept naming the media type it negotiated.
  const accept = request.headers.get("accept") ?? "";
  return accept.includes(STAR_ESCPOS_MEDIA_TYPE);
}

/**
 * GET — dual purpose:
 *  - default: POLL (returns `{ jobReady, mediaTypes }`)
 *  - `?type=<mediaType>` or Accept: <mediaType>: serve the JOB BODY bytes
 */
export async function GET(request: Request, { params }: Params): Promise<Response> {
  const { deviceToken } = await params;
  const key = resolveKey(request, deviceToken);
  if (!key) return badRequest();

  const store = getCloudPrntStore();

  if (wantsJobBody(request)) {
    const body = await getJobBody(store, key);
    if (!body) {
      // Nothing to serve — not an error; the printer just polls again.
      return jsonNoJob();
    }
    // `body.bytes` is a Uint8Array; wrap in a fresh ArrayBuffer-backed view so the
    // Response body is unambiguous BodyInit across runtimes.
    return new Response(body.bytes.slice().buffer, {
      status: 200,
      headers: {
        "Content-Type": body.contentType,
        "Content-Length": String(body.bytes.length),
        // The printer echoes this on its DELETE; surface it for diagnostics.
        "X-Star-JobToken": body.jobId,
        "Cache-Control": "no-store",
      },
    });
  }

  const poll = await buildPollResponse(store, key);
  return jsonOk(poll);
}

/**
 * POST — Star firmware's native poll (it sends a JSON status body we don't need to
 * trust). Same response as the GET poll. We never parse/trust the body beyond a
 * bounded read so a malformed/huge status can't blow up the function.
 */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { deviceToken } = await params;
  const key = resolveKey(request, deviceToken);
  if (!key) return badRequest();

  // Drain a bounded amount of the status body and discard it (defensive).
  try {
    const raw = await request.text();
    if (raw.length > 16 * 1024) {
      // Implausibly large for a printer status — answer no-job rather than work.
      return jsonNoJob();
    }
  } catch {
    // Ignore body read errors — the poll itself doesn't depend on the body.
  }

  const poll = await buildPollResponse(getCloudPrntStore(), key);
  return jsonOk(poll);
}

/**
 * DELETE — the printer confirms a successful print → dequeue. `?token=<jobId>`
 * (Star echoes the job token) only removes the matching front job; a stale or
 * mismatched DELETE is a safe no-op. Always 200 so the printer never retries the
 * delete in a tight loop.
 */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const { deviceToken } = await params;
  const key = resolveKey(request, deviceToken);
  if (!key) return badRequest();

  const jobId = new URL(request.url).searchParams.get("token")?.trim() || undefined;
  const removed = await confirmJob(getCloudPrntStore(), key, jobId);
  return jsonOk({ deleted: removed });
}

// ---------------------------------------------------------------------------
// Small response helpers.
// ---------------------------------------------------------------------------

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** A valid 200 "no job waiting" poll reply. */
function jsonNoJob(): Response {
  return jsonOk({ jobReady: false });
}

function badRequest(): Response {
  return new Response(JSON.stringify({ error: "businessId and deviceToken are required" }), {
    status: 400,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
