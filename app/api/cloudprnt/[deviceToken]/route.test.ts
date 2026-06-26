import { describe, it, expect, beforeEach } from "vitest";
import { GET, POST, DELETE } from "./route";
import { getCloudPrntStore } from "@/features/peripherals/cloudprnt-store";
import {
  enqueueReceipt,
  STAR_ESCPOS_MEDIA_TYPE,
  type QueueKey,
} from "@/features/peripherals/cloudprnt";
import type { EscPosReceipt } from "@/features/peripherals/escpos";

// ---------------------------------------------------------------------------
// Helpers — drive the route handlers in-process with plain Request objects.
// ---------------------------------------------------------------------------

const BUSINESS = "biz-route-1";
const TOKEN = "tok-route-A";
const key: QueueKey = { businessId: BUSINESS, deviceToken: TOKEN };

function url(token = TOKEN, query: Record<string, string> = {}): string {
  const params = new URLSearchParams({ businessId: BUSINESS, ...query });
  return `https://pos.example/api/cloudprnt/${encodeURIComponent(token)}?${params}`;
}

function params(token = TOKEN) {
  return { params: Promise.resolve({ deviceToken: token }) };
}

const receipt: EscPosReceipt = {
  businessName: "Valla Cafe",
  orderNumber: 99,
  createdAt: "2026-06-25T10:00:00.000Z",
  currency: "USD",
  customerName: null,
  lines: [{ name: "Tea", quantity: 1, unitPriceCents: 200, lineTotalCents: 200 }],
  subtotalCents: 200,
  discountCents: 0,
  taxCents: 0,
  tipCents: 0,
  totalCents: 200,
  payments: [{ methodLabel: "Cash", amountCents: 200 }],
};

// Each test starts from an empty queue for our key.
beforeEach(async () => {
  const store = getCloudPrntStore();
  // Drain anything left from a previous test.
  while (await store.dequeue(key)) {
    /* drain */
  }
});

// ---------------------------------------------------------------------------
// Validation.
// ---------------------------------------------------------------------------

describe("CloudPRNT route — validation", () => {
  it("400 when businessId is missing", async () => {
    const req = new Request(`https://pos.example/api/cloudprnt/${TOKEN}`);
    const res = await GET(req, params());
    expect(res.status).toBe(400);
  });

  it("400 when deviceToken is empty", async () => {
    const req = new Request(url(""));
    const res = await GET(req, params(""));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Poll (GET + POST).
// ---------------------------------------------------------------------------

describe("CloudPRNT route — poll", () => {
  it("GET poll on empty queue → jobReady:false", async () => {
    const res = await GET(new Request(url()), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobReady: false });
  });

  it("GET poll with a queued job → jobReady:true + mediaTypes + token", async () => {
    const job = await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const res = await GET(new Request(url()), params());
    const body = await res.json();
    expect(body.jobReady).toBe(true);
    expect(body.mediaTypes).toEqual([STAR_ESCPOS_MEDIA_TYPE]);
    expect(body.jobToken).toBe(job.id);
  });

  it("POST poll (Star native) behaves like GET poll and tolerates a status body", async () => {
    await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const req = new Request(url(), {
      method: "POST",
      body: JSON.stringify({ status: "online", printerMAC: "00:11:22" }),
    });
    const res = await POST(req, params());
    expect((await res.json()).jobReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Job body (GET with type/Accept).
// ---------------------------------------------------------------------------

describe("CloudPRNT route — job body", () => {
  it("serves the ESC/POS bytes with the right Content-Type via ?type=", async () => {
    const job = await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const res = await GET(new Request(url(TOKEN, { type: STAR_ESCPOS_MEDIA_TYPE })), params());
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(STAR_ESCPOS_MEDIA_TYPE);
    expect(res.headers.get("x-star-jobtoken")).toBe(job.id);
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes).toEqual(job.bytes);
  });

  it("serves the body when Accept names the media type", async () => {
    await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const req = new Request(url(), { headers: { Accept: STAR_ESCPOS_MEDIA_TYPE } });
    const res = await GET(req, params());
    expect(res.headers.get("content-type")).toBe(STAR_ESCPOS_MEDIA_TYPE);
  });

  it("body request on empty queue → 200 no-job (not an error)", async () => {
    const res = await GET(new Request(url(TOKEN, { type: STAR_ESCPOS_MEDIA_TYPE })), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ jobReady: false });
  });
});

// ---------------------------------------------------------------------------
// Confirm (DELETE) + the full round-trip.
// ---------------------------------------------------------------------------

describe("CloudPRNT route — confirm + round-trip", () => {
  it("DELETE with the job token dequeues; next poll is empty", async () => {
    const job = await enqueueReceipt(getCloudPrntStore(), key, receipt);

    // poll → ready
    expect((await (await GET(new Request(url()), params())).json()).jobReady).toBe(true);

    // body → bytes
    const bodyRes = await GET(new Request(url(TOKEN, { type: STAR_ESCPOS_MEDIA_TYPE })), params());
    expect(new Uint8Array(await bodyRes.arrayBuffer())).toEqual(job.bytes);

    // confirm → deleted
    const del = await DELETE(new Request(url(TOKEN, { token: job.id })), params());
    expect(await del.json()).toEqual({ deleted: true });

    // next poll → no job
    expect(await (await GET(new Request(url()), params())).json()).toEqual({ jobReady: false });
  });

  it("DELETE with a stale token is a no-op (deleted:false), job stays", async () => {
    await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const del = await DELETE(new Request(url(TOKEN, { token: "stale" })), params());
    expect(await del.json()).toEqual({ deleted: false });
    expect((await (await GET(new Request(url()), params())).json()).jobReady).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Tenant / device isolation.
// ---------------------------------------------------------------------------

describe("CloudPRNT route — isolation", () => {
  it("a different deviceToken sees no job", async () => {
    await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const otherToken = "tok-route-OTHER";
    const res = await GET(new Request(url(otherToken)), params(otherToken));
    expect(await res.json()).toEqual({ jobReady: false });
  });

  it("a different businessId (same token) sees no job", async () => {
    await enqueueReceipt(getCloudPrntStore(), key, receipt);
    const otherBizUrl = `https://pos.example/api/cloudprnt/${TOKEN}?businessId=biz-OTHER`;
    const res = await GET(new Request(otherBizUrl), params());
    expect(await res.json()).toEqual({ jobReady: false });
  });
});
