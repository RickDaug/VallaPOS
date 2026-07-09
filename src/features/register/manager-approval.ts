import "server-only";

import { db } from "@/lib/db";
import {
  assertApprovalNotLocked,
  recordApprovalFailure,
  recordApprovalSuccess,
  recordSuccess,
} from "@/lib/pin-throttle";
import { verifyPin } from "@/features/employees/pin";

/**
 * Manager-approval gate for UNVERIFIED tenders (QR / MANUAL "Other").
 *
 * A cash sale is "verified" — the money is physically in the drawer. A QR or
 * MANUAL tender is "operator-confirmed" with no drawer/PSP evidence, so when the
 * person ringing it can't vouch for it themselves (a cashier, who lacks the
 * `approve_unverified_tender` capability) a manager must authorize the sale by
 * entering their PIN.
 *
 * This module verifies a submitted PIN against ANY active member of THIS business
 * who HOLDS the capability (OWNER — all-access — or a member whose stored
 * permissions include `approve_unverified_tender`) and has a PIN set. The PIN is
 * verified SERVER-SIDE with the same scrypt + constant-time check + per-member
 * brute-force throttle as the operator unlock; the client value is never trusted
 * and a plaintext PIN is never logged or returned.
 *
 * The candidate's PIN that matched is irrelevant to the sale's ATTRIBUTION — the
 * caller still attributes the order to the cashier. This only answers "did a
 * capability-holder authorize it?".
 */

/** Capability that authorizes an unverified (QR/MANUAL) tender. */
export const APPROVE_UNVERIFIED_TENDER = "approve_unverified_tender" as const;

/**
 * True iff `pin` matches an active, capability-holding member of `businessId`.
 *
 * Brute-force protection lives on a SEPARATE, business-scoped APPROVAL throttle
 * namespace — never on the candidate managers' personal PIN keys. A wrong
 * approval PIN records a SINGLE failure against that approval namespace; it must
 * NOT record a failure against every non-matching manager, because those
 * personal keys are shared with the operator-unlock / clock-in / verifyMemberPin
 * throttle and doing so would let ordinary (even legitimate) approval traffic
 * lock innocent owners/managers out of their own register/clock — a
 * self-inflicted lockout with no attacker (see HIGH #8).
 *
 * Returns false — never throws — for an empty/locked/non-matching set so a
 * brute-forcer learns nothing (mirrors verifyMemberPin's anti-enumeration
 * contract). Returns false if NO member can approve (the business has no
 * manager/owner PIN configured): the override is unavailable rather than
 * implicitly granted.
 */
export async function verifyManagerApproval(
  businessId: string,
  pin: string,
): Promise<boolean> {
  // Rate-limit the approval SURFACE itself (not any manager's personal PIN
  // throttle): once too many wrong approval PINs have been entered for this
  // business recently, deny generically without even hitting the DB.
  try {
    await assertApprovalNotLocked(businessId);
  } catch {
    return false;
  }

  // Members who can approve: an OWNER (all-access) or anyone whose stored
  // permissions include the capability. Active + PIN set. Tenant-scoped.
  const candidates = await db.membership.findMany({
    where: {
      businessId,
      active: true,
      pinHash: { not: null },
      OR: [{ role: "OWNER" }, { permissions: { has: APPROVE_UNVERIFIED_TENDER } }],
    },
    select: { id: true, pinHash: true },
  });

  for (const candidate of candidates) {
    if (verifyPin(pin, candidate.pinHash)) {
      // Matched: authorize. Clear the approval counter, and reset ONLY this
      // manager's own throttle (a correct PIN is proof of identity) — no other
      // manager's key is touched.
      await recordSuccess(businessId, candidate.id);
      await recordApprovalSuccess(businessId);
      return true;
    }
  }

  // Matched no capable manager: record a SINGLE failure against the approval
  // namespace — never against any individual manager's personal PIN key.
  await recordApprovalFailure(businessId);
  return false;
}
