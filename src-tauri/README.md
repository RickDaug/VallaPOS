# VallaPOS desktop (`src-tauri/`)

The Tauri v2 shell for the **offline (local) edition** (see `../docs/EDITIONS.md` §3/§5).
It wraps the same Next.js frontend as the cloud app — built as a static export with
`NEXT_PUBLIC_VALLA_EDITION=local` — and adds the two native concerns the browser can't do:

- **`tauri-plugin-sql`** ships SQLite inside the binary; its JS `Database` is adapted to the
  store's `SqlDriver` by `../src/lib/data-store/sqlite/tauri-driver.ts`.
- **`print_raw` / `open_drawer`** (`src/lib.rs`) send pre-formatted ESC/POS bytes (from the
  shared `../src/features/peripherals/escpos.ts`) to a thermal printer + cash drawer natively.

## ⚠ Status: scaffold, NOT yet built

This directory was authored **without a local Rust toolchain**, so it has **not been
`cargo build`-verified**. The TypeScript seam it plugs into (driver adapter, local store
factory, native print transport, auto-print) IS fully unit-tested and green.

## Finishing it (needs the toolchain / a human)

1. **Install prerequisites:** Rust (`rustup`), the Tauri CLI (`npm i -D @tauri-apps/cli`), and
   the JS runtime deps (`npm i @tauri-apps/api @tauri-apps/plugin-sql @tauri-apps/plugin-store`
   — pin exact versions, per repo policy).
2. **Generate icons:** `npx tauri icon path/to/vallapos-logo.png` (creates `icons/`).
3. **Frontend static export (Stage 5-finish):** wire `output: 'export'` for the local build and
   add the `dev:local` / `build:local` npm scripts referenced by `tauri.conf.json`. The
   cash-path `page.tsx` shells must fetch through the DataStore seam client-side (no server
   actions/RSC in a static export) — gated on `isLocal` so the cloud build keeps its server
   render path. Also swap the register's checkout to call the local store + auto-print.
4. **Run it:** `cargo build` (from here) to resolve `Cargo.lock`, then `npx tauri dev`.
5. **Package (Stage 7):** `npx tauri build` → `.msi`/NSIS + `.dmg`; code-sign + notarize.

Versions in `Cargo.toml` are pinned to the Tauri **v2** line; `cargo build` resolves exact
patch versions into `Cargo.lock`.
