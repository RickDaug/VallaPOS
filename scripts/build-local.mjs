/**
 * Route-staging build for the OFFLINE (Tauri) edition (docs/EDITIONS.md §5b).
 *
 * `output:'export'` (the local Next config) statically exports the ENTIRE app,
 * but the cloud app is full of routes that CANNOT be static and are irrelevant to
 * an offline desktop app: every `app/api/*` route handler, `middleware.ts` (the
 * CSP), the SEO routes, and the auth/marketing/payments surfaces. `export` also
 * bans Server Actions app-wide.
 *
 * So for the local build we temporarily MOVE those cloud-only paths out of the
 * tree, run `next build`, then ALWAYS move them back. Safe by construction:
 *   - every move is recorded in a manifest, restored in a `finally`;
 *   - on startup we first restore any leftovers from a previously-killed run;
 *   - a moved path never overwrites (rename only).
 *
 * This does NOT by itself make the export succeed — the KEPT desktop pages still
 * import Server Actions and server auth and must be converted to client-fetch
 * through the local store (the remaining §5b work). Run with `--dry` to stage +
 * restore only (no build) to verify the tree is left untouched.
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const ROOT = process.cwd();
const STAGE = join(ROOT, ".local-build-stage");
const MANIFEST = join(STAGE, "manifest.json");

/** Cloud-only paths excluded from the offline static export (relative to root). */
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
  // A route handler nested inside the kept (app) tree — the CSV export (dynamic,
  // not exportable). The register/reports pages themselves stay; only this handler
  // is excluded (offline reports export can be re-added client-side later).
  "app/(app)/[businessId]/reports/export",
];

const flat = (rel) => rel.replace(/[\\/]/g, "__");

async function restoreFromManifest() {
  if (!existsSync(MANIFEST)) return;
  const moved = JSON.parse(await readFile(MANIFEST, "utf8"));
  for (const rel of moved) {
    const staged = join(STAGE, flat(rel));
    const original = join(ROOT, rel);
    if (existsSync(staged) && !existsSync(original)) {
      await mkdir(dirname(original), { recursive: true });
      await rename(staged, original);
    }
  }
  await rm(STAGE, { recursive: true, force: true });
}

async function stageOut() {
  await mkdir(STAGE, { recursive: true });
  const moved = [];
  // Write the manifest BEFORE moving, so a crash mid-move is still recoverable.
  await writeFile(MANIFEST, JSON.stringify(EXCLUDE));
  for (const rel of EXCLUDE) {
    const from = join(ROOT, rel);
    if (!existsSync(from)) continue;
    await rename(from, join(STAGE, flat(rel)));
    moved.push(rel);
  }
  await writeFile(MANIFEST, JSON.stringify(moved));
  return moved;
}

async function main() {
  const dry = process.argv.includes("--dry");

  await restoreFromManifest(); // recover from any prior killed run
  const moved = await stageOut();
  console.log(`[build-local] staged out ${moved.length} cloud-only path(s):\n  ${moved.join("\n  ")}`);

  try {
    if (dry) {
      console.log("[build-local] --dry: skipping next build.");
    } else {
      execSync("cross-env NEXT_PUBLIC_VALLA_EDITION=local next build", { stdio: "inherit" });
    }
  } finally {
    await restoreFromManifest();
    console.log("[build-local] restored all staged paths.");
  }
}

main().catch(async (err) => {
  await restoreFromManifest();
  console.error(err);
  process.exit(1);
});
