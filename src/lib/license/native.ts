/**
 * Bridge from the offline webview to the Rust license trust anchor
 * (`src-tauri/src/license.rs` via the `check_license` command). Rust runs the
 * AUTHORITATIVE Ed25519 `verify_strict` against the embedded public key plus the
 * expiry/revocation checks; this is what the SQLite boot-gate (`local-bootstrap.tsx`)
 * consults BEFORE it opens the local store, so reaching the data requires a valid
 * signature — not just the in-JS `LocalLicenseGate` (which is the UX layer only).
 *
 * `@tauri-apps/api/core` is imported DYNAMICALLY, and only when actually invoking, so
 * the cloud bundle never includes `@tauri-apps` (matching the rest of the local seam).
 */
import { isTauriRuntime } from "@/lib/tauri/runtime";

// Re-export so existing importers of `isTauriRuntime` from this module keep working.
export { isTauriRuntime };

/** The `check_license` error codes Rust returns (the `Err(String)` payloads, lib.rs). */
export type LicenseErrorCode =
  | "malformed"
  | "bad_signature"
  | "unsupported_version"
  | "expired"
  | "revoked";

export type NativeLicenseVerdict =
  | { ok: true; sku: string }
  | { ok: false; reason: LicenseErrorCode | "unlicensed" | "unavailable" };

const ERROR_CODES: ReadonlySet<string> = new Set<LicenseErrorCode>([
  "malformed",
  "bad_signature",
  "unsupported_version",
  "expired",
  "revoked",
]);

/**
 * Normalize whatever `invoke("check_license")` rejected with to a known code. Rust
 * rejects with one of the `LicenseErrorCode` strings; anything unexpected (a thrown
 * Error, a transport failure) is treated as `malformed` — fail closed.
 */
export function toLicenseErrorCode(thrown: unknown): LicenseErrorCode {
  const code = typeof thrown === "string" ? thrown : "";
  return ERROR_CODES.has(code) ? (code as LicenseErrorCode) : "malformed";
}

/**
 * Ask the Rust trust anchor whether `blob` is a valid license at `nowMs`. Returns a
 * verdict rather than throwing: `unlicensed` when no blob is stored, `unavailable`
 * when not running under Tauri (so callers decide how to degrade), otherwise Rust's
 * verdict — `ok` + the licensed SKU, or the mapped error reason.
 */
export async function nativeCheckLicense(
  blob: string | null | undefined,
  nowMs: number,
): Promise<NativeLicenseVerdict> {
  if (!blob) return { ok: false, reason: "unlicensed" };
  if (!isTauriRuntime()) return { ok: false, reason: "unavailable" };
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    // Tauri maps the camelCase `nowMs` to the Rust `now_ms: u64` parameter.
    const sku = await invoke<string>("check_license", { blob, nowMs });
    return { ok: true, sku };
  } catch (thrown) {
    return { ok: false, reason: toLicenseErrorCode(thrown) };
  }
}
