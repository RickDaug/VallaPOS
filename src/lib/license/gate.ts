/**
 * License GATE state resolution for the offline edition (docs/EDITIONS.md §6). Pure
 * + injected: the license blob loader (the local store, `./store.ts`) and the
 * Ed25519 `VerifyFn` (`./webcrypto.ts`) are passed in, so this is unit-testable and
 * runs identically in the boot flow and the license entry screen.
 *
 * ⚠ This is the WEBVIEW (UX) gate — it renders the licensed / unlicensed / invalid
 * state. The AUTHORITATIVE gate is the Rust `verify_license` (`src-tauri/src/
 * license.rs`), which refuses to open the SQLite store without a valid signature.
 */
import { verifyLicense, type VerifyFn, type LicenseClaims } from "./license";

export type LicenseState =
  | { status: "licensed"; claims: LicenseClaims }
  | { status: "unlicensed" } // no license stored yet — show the entry screen
  | {
      status: "invalid";
      reason: "malformed" | "bad_signature" | "unsupported_version" | "expired" | "revoked";
    };

/**
 * Resolve the current license state: load the stored blob (null → unlicensed) and
 * verify it. A stored-but-bad license is `invalid` with a reason the UI maps to a
 * message ("expired", "revoked", …) rather than silently treating it as unlicensed.
 */
export async function resolveLicenseState(args: {
  loadBlob: () => Promise<string | null> | string | null;
  verify: VerifyFn;
  now?: number;
  revokedIds?: Iterable<string>;
}): Promise<LicenseState> {
  const blob = await args.loadBlob();
  if (!blob) return { status: "unlicensed" };

  const result = await verifyLicense(blob, args.verify, {
    now: args.now,
    revokedIds: args.revokedIds,
  });
  return result.valid
    ? { status: "licensed", claims: result.claims }
    : { status: "invalid", reason: result.reason };
}

/** True only when a valid, in-date, non-revoked license is present. */
export function isLicensed(state: LicenseState): state is { status: "licensed"; claims: LicenseClaims } {
  return state.status === "licensed";
}
