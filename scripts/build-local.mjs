/**
 * Route-staging build for the OFFLINE (Tauri) edition (docs/EDITIONS.md §5b).
 *
 * `output:'export'` statically exports the ENTIRE app, but the cloud app is full
 * of routes/APIs that can't be static and are irrelevant offline, and `export`
 * bans Server Actions + request-time dynamic (headers/cookies/server auth)
 * app-wide. So for the local build we, temporarily and reversibly:
 *   - EXCLUDE cloud-only paths + not-yet-converted pages (move them out); and
 *   - SWAP in `*.local.tsx` client variants over their cloud `*.tsx` counterparts.
 * Then run `next build`, then ALWAYS restore everything.
 *
 * Safe by construction: every mutation is recorded in a manifest and reversed in
 * a `finally`; on startup we first undo any leftovers from a killed run; a moved
 * path never overwrites. `--dry` stages + restores without building (to verify the
 * tree is left byte-for-byte clean).
 *
 * Incremental: as a page is converted (a `*.local.tsx` added), move it from
 * EXCLUDE into SWAP so the export grows one verified page at a time.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const STAGE = join(ROOT, ".local-build-stage");
const MANIFEST = join(STAGE, "manifest.json");

/** Cloud-only or not-yet-converted paths removed from the offline export. */
const EXCLUDE = [
  "middleware.ts",
  "app/api",
  "app/(auth)",
  "app/desktop",
  "app/pay",
  "app/sitemap.ts",
  "app/robots.ts",
  "app/manifest.ts",
  "app/opengraph-image.tsx",
  "app/sw.ts",
  "app/~offline",
  "app/(app)/start",
  // (app)/[businessId] pages not yet converted to client-fetch — added to SWAP
  // one at a time as they're done.
  "app/(app)/[businessId]/reports/export", // the CSV route handler (dynamic) — the reports PAGE is swapped
  "app/(app)/[businessId]/floor",
  "app/(app)/[businessId]/orders/[orderId]",
];

/** [cloud file, local client variant] — cloud is stashed, the local copied over it. */
const SWAP = [
  ["app/layout.tsx", "app/layout.local.tsx"],
  ["app/page.tsx", "app/page.local.tsx"],
  ["app/(app)/layout.tsx", "app/(app)/layout.local.tsx"],
  ["app/(app)/[businessId]/layout.tsx", "app/(app)/[businessId]/layout.local.tsx"],
  ["app/(app)/[businessId]/orders/page.tsx", "app/(app)/[businessId]/orders/page.local.tsx"],
  ["app/(app)/[businessId]/register/page.tsx", "app/(app)/[businessId]/register/page.local.tsx"],
  ["app/(app)/[businessId]/reports/page.tsx", "app/(app)/[businessId]/reports/page.local.tsx"],
  ["app/(app)/[businessId]/drawer/page.tsx", "app/(app)/[businessId]/drawer/page.local.tsx"],
  ["app/(app)/[businessId]/products/page.tsx", "app/(app)/[businessId]/products/page.local.tsx"],
  ["app/(app)/[businessId]/settings/page.tsx", "app/(app)/[businessId]/settings/page.local.tsx"],
  ["app/(app)/[businessId]/employees/page.tsx", "app/(app)/[businessId]/employees/page.local.tsx"],
  // Local-only query-param receipt route (no cloud counterpart — cloud uses the
  // dynamic /orders/[orderId]/receipt, which static export can't pre-render).
  ["app/(app)/[businessId]/receipt/page.tsx", "app/(app)/[businessId]/receipt/page.local.tsx"],
];

const flat = (rel) => rel.replace(/[\\/]/g, "__");
const stashPath = (rel) => join(STAGE, flat(rel));

async function restoreAll() {
  if (!existsSync(MANIFEST)) return;
  const { excludes = [], swaps = [] } = JSON.parse(await readFile(MANIFEST, "utf8"));
  // Undo swaps: remove the copied-in local file; move the stashed cloud file back
  // (only if there WAS an original — a local-only route has none to restore).
  for (const entry of swaps) {
    const { cloudRel, hadOriginal } =
      typeof entry === "string" ? { cloudRel: entry, hadOriginal: true } : entry;
    const cloud = join(ROOT, cloudRel);
    const stash = stashPath("swap__" + cloudRel);
    if (existsSync(cloud)) await rm(cloud, { force: true });
    if (hadOriginal && existsSync(stash)) {
      await mkdir(dirname(cloud), { recursive: true });
      await rename(stash, cloud);
    }
  }
  // Undo excludes: move each stashed path back.
  for (const rel of excludes) {
    const stash = stashPath(rel);
    const original = join(ROOT, rel);
    if (existsSync(stash) && !existsSync(original)) {
      await mkdir(dirname(original), { recursive: true });
      await rename(stash, original);
    }
  }
  await rm(STAGE, { recursive: true, force: true });
}

async function apply() {
  await mkdir(STAGE, { recursive: true });
  const done = { excludes: [], swaps: [] };
  // Write the (empty) manifest first so a crash is still recoverable, then record
  // each mutation as it happens.
  await writeFile(MANIFEST, JSON.stringify(done));

  for (const rel of EXCLUDE) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue;
    await rename(from, stashPath(rel));
    done.excludes.push(rel);
    await writeFile(MANIFEST, JSON.stringify(done));
  }
  for (const [cloudRel, localRel] of SWAP) {
    const cloud = join(ROOT, cloudRel);
    const local = join(ROOT, localRel);
    if (!existsSync(local)) throw new Error(`SWAP source missing: ${localRel}`);
    const hadOriginal = existsSync(cloud);
    if (hadOriginal) await rename(cloud, stashPath("swap__" + cloudRel));
    else await mkdir(dirname(cloud), { recursive: true }); // local-only route (e.g. the query-param receipt)
    await copyFile(local, cloud);
    done.swaps.push({ cloudRel, hadOriginal });
    await writeFile(MANIFEST, JSON.stringify(done));
  }
  return done;
}

async function main() {
  const dry = process.argv.includes("--dry");
  await restoreAll(); // recover from any prior killed run
  const done = await apply();
  console.log(
    `[build-local] excluded ${done.excludes.length} path(s), swapped ${done.swaps.length} local variant(s).`,
  );
  try {
    if (dry) console.log("[build-local] --dry: skipping next build.");
    else execSync("cross-env NEXT_PUBLIC_VALLA_EDITION=local next build", { stdio: "inherit" });
  } finally {
    await restoreAll();
    // Drop the generated route types: the staged build emits types for local-only
    // routes (e.g. the query-param receipt) that no longer exist after restore, so
    // a later `tsc`/cloud build would choke on the dangling reference. Regenerated
    // by the next build.
    await rm(join(ROOT, ".next", "types"), { recursive: true, force: true }).catch(() => {});
    console.log("[build-local] restored the tree.");
  }
}

main().catch(async (err) => {
  await restoreAll();
  console.error(err);
  process.exit(1);
});
