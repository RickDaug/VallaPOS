import { NextResponse } from "next/server";
import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { countIncomingOnlineOrders } from "@/features/online/queries";

/**
 * Lightweight incoming-online-order counts for the live nav badge + "new order"
 * poller. Membership-gated + tenant-scoped (via requireMembership → the query is
 * `where: { businessId }`). Returns `{ submitted, active }`.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;
  try {
    await requireMembership(businessId);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    throw err;
  }
  const counts = await countIncomingOnlineOrders(businessId);
  return NextResponse.json(counts, { headers: { "cache-control": "no-store" } });
}
