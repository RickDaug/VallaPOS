import "server-only";

import { requireMembership, ForbiddenError } from "@/lib/tenant";
import { getActiveOperator, type ActiveOperator } from "@/lib/operator";
import { can, type Capability } from "@/lib/capabilities";

/**
 * Thrown when a capability-gated action runs with no active operator (the device
 * is "locked"). The UI surfaces the operator lock screen in response. Distinct
 * from ForbiddenError (which means an operator IS active but lacks the capability).
 */
export class OperatorLockedError extends Error {
  constructor() {
    super("LOCKED");
    this.name = "OperatorLockedError";
  }
}

export interface OperatorContext extends ActiveOperator {
  businessId: string;
  /** The signed-in device member (tenant gate); not necessarily the operator. */
  deviceMembershipId: string;
}

/**
 * The capability choke point for operational actions. Establishes the device's
 * tenant membership (so we're allowed in this business at all), then requires an
 * active operator that HAS the capability. Returns the operator context — use
 * `.membershipId` for attribution (cashierId).
 */
/**
 * Non-throwing capability check for PAGE server components (gating reads). Returns
 * false when locked OR the operator lacks the capability; the page renders a
 * NoAccess notice. (When locked, the shell layout already overlays the lock, so
 * the page body isn't shown — this just avoids running the page's queries.)
 */
export async function pageHasCapability(businessId: string, cap: Capability): Promise<boolean> {
  const operator = await getActiveOperator(businessId);
  return operator ? can(operator.role, operator.permissions, cap) : false;
}

export async function requireCapability(businessId: string, cap: Capability): Promise<OperatorContext> {
  const ctx = await requireMembership(businessId);
  const operator = await getActiveOperator(businessId);
  if (!operator) throw new OperatorLockedError();
  if (!can(operator.role, operator.permissions, cap)) {
    throw new ForbiddenError(`REQUIRES_CAPABILITY_${cap}`);
  }
  return { ...operator, businessId, deviceMembershipId: ctx.membershipId };
}
