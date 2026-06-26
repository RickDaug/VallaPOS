import { describe, it, expect, beforeEach } from "vitest";
import {
  InMemoryQueueStore,
  buildPollResponse,
  buildReceiptJob,
  confirmJob,
  enqueueReceipt,
  getJobBody,
  newJobId,
  STAR_ESCPOS_MEDIA_TYPE,
  type PrintJob,
  type QueueKey,
  type QueueStore,
} from "./cloudprnt";
import { CMD } from "./escpos";
import type { EscPosReceipt } from "./escpos";

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

const keyA: QueueKey = { businessId: "biz-1", deviceToken: "tok-A" };
const keyB: QueueKey = { businessId: "biz-1", deviceToken: "tok-B" };
const keyOtherBiz: QueueKey = { businessId: "biz-2", deviceToken: "tok-A" };

const receipt: EscPosReceipt = {
  businessName: "Valla Cafe",
  orderNumber: 7,
  createdAt: "2026-06-25T10:00:00.000Z",
  currency: "USD",
  customerName: null,
  lines: [
    { name: "Coffee", quantity: 1, unitPriceCents: 300, lineTotalCents: 300 },
  ],
  subtotalCents: 300,
  discountCents: 0,
  taxCents: 25,
  tipCents: 0,
  totalCents: 325,
  payments: [{ methodLabel: "Cash", amountCents: 325, tenderedCents: 400, changeCents: 75 }],
};

function makeJob(id: string, bytes = Uint8Array.of(1, 2, 3)): PrintJob {
  return { id, bytes, mediaType: STAR_ESCPOS_MEDIA_TYPE, enqueuedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// InMemoryQueueStore — FIFO + tenant isolation.
// ---------------------------------------------------------------------------

describe("InMemoryQueueStore", () => {
  let store: QueueStore;
  beforeEach(() => {
    store = new InMemoryQueueStore();
  });

  it("enqueue → peek returns the front without removing", async () => {
    await store.enqueue(keyA, makeJob("j1"));
    expect((await store.peek(keyA))?.id).toBe("j1");
    expect((await store.peek(keyA))?.id).toBe("j1"); // still there
    expect(await store.size(keyA)).toBe(1);
  });

  it("is FIFO", async () => {
    await store.enqueue(keyA, makeJob("j1"));
    await store.enqueue(keyA, makeJob("j2"));
    expect((await store.peek(keyA))?.id).toBe("j1");
    expect((await store.dequeue(keyA))?.id).toBe("j1");
    expect((await store.peek(keyA))?.id).toBe("j2");
  });

  it("dequeue with a matching id removes the front", async () => {
    await store.enqueue(keyA, makeJob("j1"));
    expect((await store.dequeue(keyA, "j1"))?.id).toBe("j1");
    expect(await store.size(keyA)).toBe(0);
  });

  it("dequeue with a non-matching id is a no-op", async () => {
    await store.enqueue(keyA, makeJob("j1"));
    expect(await store.dequeue(keyA, "WRONG")).toBeNull();
    expect(await store.size(keyA)).toBe(1);
  });

  it("dequeue on an empty queue returns null", async () => {
    expect(await store.dequeue(keyA)).toBeNull();
    expect(await store.peek(keyA)).toBeNull();
  });

  it("isolates queues by deviceToken", async () => {
    await store.enqueue(keyA, makeJob("jA"));
    expect(await store.peek(keyB)).toBeNull();
    expect(await store.size(keyB)).toBe(0);
  });

  it("isolates queues by businessId (same token, different business)", async () => {
    await store.enqueue(keyA, makeJob("jA"));
    expect(await store.peek(keyOtherBiz)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// newJobId.
// ---------------------------------------------------------------------------

describe("newJobId", () => {
  it("produces unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newJobId()));
    expect(ids.size).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// buildReceiptJob / enqueueReceipt — receipt → ESC/POS bytes.
// ---------------------------------------------------------------------------

describe("receipt jobs", () => {
  it("buildReceiptJob formats real ESC/POS bytes (starts with INIT)", () => {
    const job = buildReceiptJob(receipt);
    expect(job.mediaType).toBe(STAR_ESCPOS_MEDIA_TYPE);
    expect(job.bytes.length).toBeGreaterThan(0);
    // ESC @ init prefix.
    expect(job.bytes[0]).toBe(CMD.INIT[0]);
    expect(job.bytes[1]).toBe(CMD.INIT[1]);
  });

  it("enqueueReceipt formats + enqueues and returns the job", async () => {
    const store = new InMemoryQueueStore();
    const job = await enqueueReceipt(store, keyA, receipt);
    expect(await store.size(keyA)).toBe(1);
    expect((await store.peek(keyA))?.id).toBe(job.id);
  });
});

// ---------------------------------------------------------------------------
// The full poll → fetch body → confirm round-trip (pure layer).
// ---------------------------------------------------------------------------

describe("CloudPRNT round-trip (pure)", () => {
  let store: QueueStore;
  beforeEach(() => {
    store = new InMemoryQueueStore();
  });

  it("empty queue → poll reports no job", async () => {
    expect(await buildPollResponse(store, keyA)).toEqual({ jobReady: false });
    expect(await getJobBody(store, keyA)).toBeNull();
  });

  it("enqueue → poll jobReady → body matches bytes → confirm dequeues → no job", async () => {
    const job = await enqueueReceipt(store, keyA, receipt);

    // Poll reports ready + media types + the job token.
    const poll = await buildPollResponse(store, keyA);
    expect(poll.jobReady).toBe(true);
    expect(poll.mediaTypes).toEqual([STAR_ESCPOS_MEDIA_TYPE]);
    expect(poll.jobToken).toBe(job.id);

    // Body returns the exact ESC/POS bytes; peek does NOT dequeue.
    const body = await getJobBody(store, keyA);
    expect(body?.contentType).toBe(STAR_ESCPOS_MEDIA_TYPE);
    expect(body?.jobId).toBe(job.id);
    expect(body?.bytes).toEqual(job.bytes);
    expect(await store.size(keyA)).toBe(1);

    // Confirm with the right id dequeues; next poll is empty.
    expect(await confirmJob(store, keyA, job.id)).toBe(true);
    expect(await buildPollResponse(store, keyA)).toEqual({ jobReady: false });
    expect(await getJobBody(store, keyA)).toBeNull();
  });

  it("confirm with a stale id leaves the job queued (at-least-once)", async () => {
    const job = await enqueueReceipt(store, keyA, receipt);
    expect(await confirmJob(store, keyA, "stale-id")).toBe(false);
    expect((await buildPollResponse(store, keyA)).jobReady).toBe(true);
    // The real job still confirms.
    expect(await confirmJob(store, keyA, job.id)).toBe(true);
  });

  it("a different deviceToken sees no job (tenant/device isolation)", async () => {
    await enqueueReceipt(store, keyA, receipt);
    expect((await buildPollResponse(store, keyB)).jobReady).toBe(false);
    expect(await getJobBody(store, keyB)).toBeNull();
    // And keyA's job is untouched by keyB's confirm attempt.
    expect(await confirmJob(store, keyB)).toBe(false);
    expect(await store.size(keyA)).toBe(1);
  });

  it("multiple jobs drain in FIFO order across poll/body/confirm cycles", async () => {
    const j1 = await enqueueReceipt(store, keyA, { ...receipt, orderNumber: 1 });
    const j2 = await enqueueReceipt(store, keyA, { ...receipt, orderNumber: 2 });

    expect((await buildPollResponse(store, keyA)).jobToken).toBe(j1.id);
    expect((await getJobBody(store, keyA))?.jobId).toBe(j1.id);
    await confirmJob(store, keyA, j1.id);

    expect((await buildPollResponse(store, keyA)).jobToken).toBe(j2.id);
    await confirmJob(store, keyA, j2.id);
    expect((await buildPollResponse(store, keyA)).jobReady).toBe(false);
  });
});
