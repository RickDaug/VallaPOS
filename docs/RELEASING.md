# Releasing the offline desktop edition

Packaging, code-signing, and distribution for the **offline (local) edition** — the
Tauri desktop app sold once ($99) on vallahub.com. See `docs/EDITIONS.md` for the full
architecture; this doc is the operational checklist for cutting a release (Stage 7).

The `.github/workflows/desktop-release.yml` workflow builds + drafts a GitHub Release on a
`v*` tag (or manual dispatch). It is **independent of the `quality` CI** and never runs on
pull requests, so it can't gate a merge.

## Before the first real build (Stage 5b / 6b prerequisites)

The workflow will not produce a working installer until these land — it is scaffolded ahead
of them on purpose:

1. **Static export succeeds.** `npm run build:local` must emit `out/` — the cash-path
   `page.tsx` shells need converting from server-fetch to client-fetch through the DataStore
   seam (a static export bans server actions / middleware / request-time RSC), gated on
   `isLocal`. The register must call `createLocalDataStore` and `printOrderById` after checkout.
2. **JS + CLI deps.** `npm i -D @tauri-apps/cli` and `npm i @tauri-apps/api @tauri-apps/plugin-sql
   @tauri-apps/plugin-store` (pin exact versions; commit the lockfile — CI runs `npm ci`).
3. **Icons.** `npx tauri icon path/to/vallapos-logo.png` → `src-tauri/icons/`.
4. **License public key.** Replace the zero `PUBLIC_KEY` placeholder in
   `src-tauri/src/license.rs` with the real 32-byte key whose private half is
   `LICENSE_SIGNING_SK` on vallahub (Stage 6b).
5. **`cargo build`** the shell once locally to resolve `src-tauri/Cargo.lock`.

## Code signing

| OS | Requirement | Cost (approx) |
|----|-------------|---------------|
| **Windows** | Azure Trusted Signing (needs a US/CA org, 3+ yr history) **or** an OV cert if ineligible. Unsigned = SmartScreen warnings. | ~$10–12/mo (Azure) or ~$220/yr (OV) |
| **macOS** | Apple Developer ID cert + `notarytool` staple, else Gatekeeper blocks the app. | $99/yr (Apple Developer) |

Year-1 signing budget ≈ **$220–320**.

### Actions secrets (macOS)

Set these in the repo's Actions secrets for the workflow's notarization step:
`APPLE_CERTIFICATE` (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
`APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`. Windows signing is configured
per the chosen provider (Azure Trusted Signing action or an OV cert in `tauri.conf.json`).

## Cutting a release

1. Bump `version` in `src-tauri/tauri.conf.json` (+ `Cargo.toml`).
2. `git tag vX.Y.Z && git push origin vX.Y.Z`.
3. The workflow builds `windows-latest` + `macos-latest` (arm64) + `macos-13` (x64) and drafts a
   GitHub Release with the `.msi`/NSIS + `.dmg` artifacts.
4. Review the draft, then publish. Link the installers from vallahub.com's download page.

## Revocation (best-effort, no phone-home)

The desktop app never calls home, so a chargeback can't remotely disable an installed copy.
Mitigations (Stage 6b): gate issuance on Stripe `payment_status: 'paid'`, mark the `License`
row revoked on `charge.dispute.created`, and ship the abuser's license `id` in the next
**signed embedded blocklist** (checked by the Rust `verify_license` `revoked` list). Treat an
escaped chargeback as cost of doing business, not an engineering problem.

## Deferred UI (Stage 5b)

A **Test print / Open drawer** diagnostic in the local Settings → Devices screen (reusing the
native Tauri transport) so a merchant can verify their printer + drawer in one tap.
