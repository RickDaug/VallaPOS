import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { pageHasCapability } from "@/lib/operator-guard";
import { getPayPeriodDetail } from "@/features/payroll/queries";
import { buildPayrollCsv } from "@/features/payroll/report";
import { db } from "@/lib/db";

/**
 * GET /[businessId]/payroll/export?period=<payPeriodId>
 * Streams a pay-run CSV download for one pay period. Gated on the manage_payroll
 * capability (payroll is sensitive). The CSV records gross/adjustments/net only —
 * NO tax withholding (see docs/PAYROLL.md).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  const { businessId } = await params;

  try {
    await requireMembership(businessId);
  } catch (err) {
    if (err instanceof AuthError) return new Response("Unauthorized", { status: 401 });
    if (err instanceof ForbiddenError) return new Response("Forbidden", { status: 403 });
    throw err;
  }

  if (!(await pageHasCapability(businessId, "manage_payroll"))) {
    return new Response("Forbidden", { status: 403 });
  }

  const periodId = new URL(request.url).searchParams.get("period");
  if (!periodId) return new Response("Missing period", { status: 400 });

  const [detail, business] = await Promise.all([
    getPayPeriodDetail(businessId, periodId),
    db.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
  ]);
  if (!detail || !business) return new Response("Not found", { status: 404 });

  const label =
    detail.label ??
    `${detail.startDate.slice(0, 10)} – ${new Date(new Date(detail.endDate).getTime() - 1).toISOString().slice(0, 10)}`;

  const csv = buildPayrollCsv({
    periodLabel: label,
    currency: business.currency,
    status: detail.status,
    slips: detail.payslips,
  });

  const filename = `vallapos-payrun-${detail.startDate.slice(0, 10)}.csv`;
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
