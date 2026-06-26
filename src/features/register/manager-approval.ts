import "server-only";

import { db } from "@/lib/db";
import { assertNotLocked, recordFailure, recordSuccess } from "@/lib/pin-throttle";
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
 * Iterates the (typically few) capability-holders with a PIN set, honoring each
 * one's throttle/lockout independently. Returns false — never throws — for an
 * empty/locked/non-matching set so a brute-forcer learns nothing (mirrors
 * verifyMemberPin's anti-enumeration contract). Returns false if NO member can
 * approve (the business has no manager/owner PIN configured): the override is
 * unavailable rather than implicitly granted.
 */
export async function verifyManagerApproval(
  businessId: string,
  pin: string,
): Promise<boolean> {
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
    // Skip a candidate that is currently locked out; try the rest.
    try {
      await assertNotLocked(businessId, candidate.id);
    } catch {
      continue;
    }
    if (verifyPin(pin, candidate.pinHash)) {
      await recordSuccess(businessId, candidate.id);
      return true;
    }
    // A wrong guess against this candidate counts toward ITS lockout — the same
    // throttle that protects the operator-unlock PIN entry.
    await recordFailure(businessId, candidate.id);
  }
  return false;
}
