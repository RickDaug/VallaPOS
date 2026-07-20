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

### Windows signing (steps)

Signing is wired through `src-tauri/tauri.conf.json` → `bundle.windows`. When set, `tauri build`
signs `vallapos.exe`, the MSI, **and** the NSIS installer automatically (via `signtool` from the
Windows SDK — no manual post-signing). Config keys:

```json
"bundle": {
  "windows": {
    "certificateThumbprint": "<40-hex SHA1 thumbprint of a cert in the Windows store>",
    "digestAlgorithm": "sha256",
    "timestampUrl": "http://timestamp.digicert.com"
  }
}
```

- **`certificateThumbprint`** — SHA1 thumbprint of a code-signing cert in the `CurrentUser\My`
  (or `LocalMachine\My`) store. Find it: `Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert |
  Select-Object Thumbprint, Subject`.
- **`timestampUrl`** — an RFC3161 server so the signature outlives the cert's validity.
- **Do not commit a machine-specific thumbprint.** Either set it only in CI, or pass it at build
  time and keep it out of the repo:
  `tauri build -c '{"bundle":{"windows":{"certificateThumbprint":"<THUMB>"}}}'`.

**Buying the cert (post-June-2023 reality).** OV/EV code-signing certs now ship on a FIPS hardware
token (YubiKey/HSM) — there is no downloadable `.pfx`. Two shipping paths:

1. **Azure Trusted Signing** (cheapest, ~$10/mo; needs a US/CA org with 3+ yr history). Sign in CI
   with `azure/trusted-signing-action`; leave `certificateThumbprint` unset.
2. **OV/EV cert on a token.** Signing runs against the token's CSP, so use a custom
   `bundle.windows.signCommand` instead of a thumbprint (the token middleware must be installed +
   unlocked); `%1` is the file Tauri passes:
   ```json
   "signCommand": "signtool sign /tr http://timestamp.digicert.com /td sha256 /fd sha256 /sha1 <THUMBPRINT> %1"
   ```
   EV gives instant SmartScreen reputation; OV earns it over time.

**Test the pipeline for free (self-signed).** Proves the whole mechanism without buying anything —
the binary is genuinely signed, but shows "unknown publisher" on machines that don't trust the cert:

```powershell
$c = New-SelfSignedCertificate -Type CodeSigningCert -Subject "CN=VallaPOS Test" `
  -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(3)
$c.Thumbprint   # → paste into bundle.windows.certificateThumbprint, then run `tauri build`
Get-AuthenticodeSignature <path> | Format-List Status, SignerCertificate, TimeStamperCertificate
```

A self-signed cert reports `Status = UnknownError` (untrusted chain) — that is **expected**; only a
CA-issued cert reports `Valid` and clears SmartScreen. To remove the test cert afterward:
`Get-ChildItem Cert:\CurrentUser\My | Where-Object Subject -eq 'CN=VallaPOS Test' | Remove-Item`.

**CI signing.** `desktop-release.yml` runs `tauri-action` on `windows-latest`; provide the cert to
the runner (the Azure action, or import a `.pfx`/token from an Actions secret into the runner store)
and set `certificateThumbprint`/`signCommand` to match.

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
