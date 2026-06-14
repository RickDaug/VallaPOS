import { db } from "@/lib/db";
import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { getDailyReport, getItemSalesReport } from "@/features/orders/queries";
import { buildReportCsv } from "@/features/orders/report-aggregate";

/**
 * GET /[businessId]/reports/export?date=YYYY-MM-DD
 * Streams the day's Z-report + item/category breakdown as a CSV download.
 * Tenant-guarded via requireMembership (any member may export their own data).
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

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  if (!business) return new Response("Not found", { status: 404 });

  const dateParam = new URL(request.url).searchParams.get("date");
  const dateStr =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)
      ? dateParam
      : new Date().toISOString().slice(0, 10);
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const [report, items] = await Promise.all([
    getDailyReport(businessId, start, end),
    getItemSalesReport(businessId, start, end),
  ]);

  const csv = buildReportCsv({
    dateStr,
    currency: business.currency,
    orderCount: report.orderCount,
    grossSalesCents: report.grossSalesCents,
    discountCents: report.discountCents,
    netSalesCents: report.netSalesCents,
    taxCents: report.taxCents,
    tipCents: report.tipCents,
    refundsCents: report.refundsCents,
    totalCollectedCents: report.totalCollectedCents,
    byMethod: report.byMethod,
    items,
  });

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vallapos-report-${dateStr}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
