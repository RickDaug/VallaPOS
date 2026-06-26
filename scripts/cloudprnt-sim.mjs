#!/usr/bin/env node
/**
 * Fake Star CloudPRNT printer — a polling SIMULATOR (no hardware needed).
 *
 * It does exactly what a real Star printer does against the CloudPRNT endpoint:
 *   1. POLL the server ("any work?") → `{ jobReady, mediaTypes }`
 *   2. when jobReady, GET the job body (raw ESC/POS bytes) and "print" it (here:
 *      log its length + a hex preview)
 *   3. DELETE to acknowledge → the server dequeues the job
 *
 * This validates the full round-trip in software. (The same logic is covered by
 * the in-process tests in `cloudprnt.test.ts`; this script is for poking a LIVE
 * server.)
 *
 * Run (needs a running app, e.g. `npm run dev`):
 *   E2E_BASE_URL=http://localhost:3000 \
 *   CLOUDPRNT_BUSINESS_ID=<businessId> \
 *   CLOUDPRNT_DEVICE_TOKEN=<deviceToken> \
 *   node scripts/cloudprnt-sim.mjs
 *
 * Defaults: BASE_URL=http://localhost:3000, businessId=demo, token=sim-printer.
 * Polls every 2s until killed (Ctrl-C).
 */

const BASE = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const BUSINESS_ID = process.env.CLOUDPRNT_BUSINESS_ID || "demo";
const TOKEN = process.env.CLOUDPRNT_DEVICE_TOKEN || "sim-printer";
const MEDIA_TYPE = "application/vnd.star.line";
const POLL_MS = Number(process.env.CLOUDPRNT_POLL_MS || 2000);

const endpoint = `${BASE}/api/cloudprnt/${encodeURIComponent(TOKEN)}?businessId=${encodeURIComponent(BUSINESS_ID)}`;

async function tick() {
  // 1. Poll.
  const poll = await fetch(endpoint, { method: "GET" }).then((r) => r.json());
  if (!poll.jobReady) {
    console.log(`[sim] no job (businessId=${BUSINESS_ID} token=${TOKEN})`);
    return;
  }
  console.log(`[sim] jobReady token=${poll.jobToken} mediaTypes=${poll.mediaTypes}`);

  // 2. Fetch the job body (ask for our media type so the route serves bytes).
  const res = await fetch(`${endpoint}&type=${encodeURIComponent(MEDIA_TYPE)}`, {
    method: "GET",
    headers: { Accept: MEDIA_TYPE },
  });
  const buf = new Uint8Array(await res.arrayBuffer());
  const jobToken = res.headers.get("x-star-jobtoken") || poll.jobToken;
  const preview = [...buf.slice(0, 24)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  console.log(`[sim] printed ${buf.length} bytes (preview: ${preview}…)`);

  // 3. Acknowledge → server dequeues.
  const del = await fetch(`${endpoint}&token=${encodeURIComponent(jobToken)}`, { method: "DELETE" });
  console.log(`[sim] ack ${del.status}`);
}

console.log(`[sim] polling ${endpoint} every ${POLL_MS}ms (Ctrl-C to stop)`);
async function loop() {
  try {
    await tick();
  } catch (err) {
    console.error("[sim] error:", err.message);
  }
  setTimeout(loop, POLL_MS);
}
loop();
