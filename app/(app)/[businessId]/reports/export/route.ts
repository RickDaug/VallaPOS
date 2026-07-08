import { db } from "@/lib/db";
import { requireMembership, AuthError, ForbiddenError } from "@/lib/tenant";
import { getDailyReport, getItemSalesReport, getCashierSalesReport } from "@/features/orders/queries";
import {
  buildReportCsv,
  buildItemSalesCsv,
  buildCategorySalesCsv,
  buildCashierSalesCsv,
  resolveReportRange,
} from "@/features/orders/report-aggregate";
import { paymentMethodLabel } from "@/features/orders/payment-method";

/**
 * GET /[businessId]/reports/export?from=YYYY-MM-DD&to=YYYY-MM-DD&table=…
 * Streams a report CSV download over the [from, to] day range (both default to
 * today; legacy `?date=` still accepted as a single-day shorthand). The `table`
 * param selects which slice to export:
 *   - (omitted) / "summary" → the full Z-report + all breakdowns
 *   - "item"     → Sales by item
 *   - "category" → Sales by category
 *   - "cashier"  → Sales by cashier (employee)
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

  const url = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const legacyDate = url.searchParams.get("date") ?? undefined;
  const range = resolveReportRange(
    url.searchParams.get("from") ?? legacyDate ?? undefined,
    url.searchParams.get("to") ?? legacyDate ?? undefined,
    today,
  );
  const start = new Date(`${range.fromStr}T00:00:00`);
  const end = new Date(`${range.toStr}T00:00:00`);
  end.setDate(end.getDate() + 1); // exclusive end = day after `to`

  const table = url.searchParams.get("table") ?? "summary";
  const meta = { rangeLabel: range.label, currency: business.currency };

  let csv: string;
  let filename: string;

  if (table === "item") {
    const items = await getItemSalesReport(businessId, start, end);
    csv = buildItemSalesCsv(items.byItem, meta);
    filename = `vallapos-sales-by-item-${range.fromStr}_${range.toStr}.csv`;
  } else if (table === "category") {
    const items = await getItemSalesReport(businessId, start, end);
    csv = buildCategorySalesCsv(items.byCategory, meta);
    filename = `vallapos-sales-by-category-${range.fromStr}_${range.toStr}.csv`;
  } else if (table === "cashier") {
    const cashiers = await getCashierSalesReport(businessId, start, end);
    csv = buildCashierSalesCsv(cashiers, meta);
    filename = `vallapos-sales-by-cashier-${range.fromStr}_${range.toStr}.csv`;
  } else {
    const [report, items, cashiers] = await Promise.all([
      getDailyReport(businessId, start, end),
      getItemSalesReport(businessId, start, end),
      getCashierSalesReport(businessId, start, end),
    ]);
    csv = buildReportCsv({
      dateStr: range.label,
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
      tenders: report.tenders,
      methodLabel: paymentMethodLabel,
      items,
      cashiers,
    });
    filename = `vallapos-report-${range.fromStr}_${range.toStr}.csv`;
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
