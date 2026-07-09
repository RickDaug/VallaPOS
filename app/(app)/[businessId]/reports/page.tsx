import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getDailyReport, getItemSalesReport, getCashierSalesReport } from "@/features/orders/queries";
import {
  resolveReportRange,
  zonedDayStartUtc,
  addDaysToDateStr,
  todayInTimeZone,
} from "@/features/orders/report-aggregate";
import { paymentMethodLabel } from "@/features/orders/payment-method";
import { pageHasCapability } from "@/lib/operator-guard";
import { NoAccess } from "@/components/no-access";
import { getDrawerDaySummary } from "@/features/cash-drawer/queries";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ from?: string; to?: string; date?: string }>;
}) {
  const { businessId } = await params;
  const { from, to, date } = await searchParams;
  await requireMembership(businessId);
  if (!(await pageHasCapability(businessId, "view_reports"))) return <NoAccess what="reports" />;

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true, timezone: true },
  });
  if (!business) notFound();

  // Resolve the [from, to] day range in the BUSINESS timezone (both default to
  // the merchant's local "today"; `?date=` is a legacy single-day shorthand).
  // The window is [local-midnight(from), local-midnight(to + 1 day)) expressed
  // as UTC instants, so a late-evening sale lands in the merchant's day — not
  // the server's UTC day.
  const range = resolveReportRange(
    from ?? date,
    to ?? date,
    todayInTimeZone(business.timezone),
  );
  const start = zonedDayStartUtc(range.fromStr, business.timezone);
  const end = zonedDayStartUtc(addDaysToDateStr(range.toStr, 1), business.timezone);

  const report = await getDailyReport(businessId, start, end);
  const drawer = await getDrawerDaySummary(businessId, start, end);
  const itemSales = await getItemSalesReport(businessId, start, end);
  const cashierSales = await getCashierSalesReport(businessId, start, end);
  const money = (c: number) => formatMoney(c, business.currency);
  const exportHref = (table?: string) =>
    `/${businessId}/reports/export?from=${range.fromStr}&to=${range.toStr}` +
    (table ? `&table=${table}` : "");

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black md:text-3xl">Sales report</h1>
          <p className="text-sm text-muted-foreground">
            Sales, tax, and cash for {range.fromStr === range.toStr ? "the day" : "the range"} —{" "}
            <span className="numeric">{range.label}</span>.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <form method="get" className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              From
              <Input
                type="date"
                name="from"
                defaultValue={range.fromStr}
                max={range.toStr}
                className="numeric h-11 w-auto"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              To
              <Input
                type="date"
                name="to"
                defaultValue={range.toStr}
                className="numeric h-11 w-auto"
              />
            </label>
            <Button type="submit" size="sm">View</Button>
          </form>
          <a
            href={exportHref()}
            download
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Export CSV
          </a>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Stat title="Orders" value={String(report.orderCount)} />
        <Stat title="Net sales" value={money(report.netSalesCents)} />
        <Stat title="Tax collected" value={money(report.taxCents)} />
        <Stat title="Total collected" value={money(report.totalCollectedCents)} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <h2 className="mb-4 text-lg font-bold">Sales breakdown</h2>
            <dl className="space-y-2 text-sm">
              <RowDl label="Gross sales" value={money(report.grossSalesCents)} />
              <RowDl label="Discounts" value={`−${money(report.discountCents)}`} />
              <RowDl label="Net sales" value={money(report.netSalesCents)} strong />
              <RowDl label="Tax" value={money(report.taxCents)} />
              <RowDl label="Tips" value={money(report.tipCents)} />
              {report.refundsCents > 0 && (
                <RowDl label="Refunds" value={`−${money(report.refundsCents)}`} />
              )}
              <RowDl label="Total collected" value={money(report.totalCollectedCents)} strong />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <h2 className="mb-4 text-lg font-bold">Payments</h2>
            {report.byMethod.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments for this day.</p>
            ) : (
              <dl className="space-y-2 text-sm">
                {report.byMethod.map((m) => (
                  <RowDl key={m.method} label={`${m.method} (${m.count})`} value={money(m.amountCents)} />
                ))}
                <div className="mt-3 border-t border-border pt-3">
                  <RowDl label="Cash collected" value={money(report.cashCollectedCents)} strong />
                </div>
              </dl>
            )}
            <div className="mt-4 border-t border-border pt-3 text-sm">
              <RowDl
                label={`Drawer variance (${drawer.closedCount} closed)`}
                value={
                  drawer.closedCount === 0
                    ? "—"
                    : drawer.netVarianceCents === 0
                      ? money(0)
                      : drawer.netVarianceCents > 0
                        ? `+${money(drawer.netVarianceCents)} over`
                        : `−${money(Math.abs(drawer.netVarianceCents))} short`
                }
                strong
              />
              {drawer.openCount > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {drawer.openCount} drawer session{drawer.openCount > 1 ? "s" : ""} still open —
                  variance is counted at close.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">Payments by tender</h2>
              <p className="text-xs text-muted-foreground">
                Audit view — which collected money is backed by evidence.
              </p>
            </div>
            {report.tenders.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No payments for this day.</p>
            ) : (
              <>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted-foreground">
                      <th className="pb-2 font-medium">Tender</th>
                      <th className="pb-2 text-right font-medium">Count</th>
                      <th className="pb-2 text-right font-medium">Collected</th>
                      <th className="pb-2 text-right font-medium">Verification</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.tenders.rows.map((t) => (
                      <tr key={t.method} className="border-b border-border/60 last:border-0">
                        <td className="py-2 pr-2">{paymentMethodLabel(t.method)}</td>
                        <td className="numeric py-2 text-right tabular-nums">{t.count}</td>
                        <td className="numeric py-2 text-right font-semibold">{money(t.amountCents)}</td>
                        <td className="py-2 text-right">
                          {t.verification === "verified" ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              Verified · in-drawer
                            </span>
                          ) : (
                            <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                              Unverified · operator-confirmed
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <dl className="mt-3 space-y-2 border-t border-border pt-3 text-sm">
                  <RowDl
                    label="Verified collected (in-drawer)"
                    value={money(report.tenders.verifiedCollectedCents)}
                  />
                  <RowDl
                    label="Unverified collected"
                    value={money(report.tenders.unverifiedCollectedCents)}
                    strong
                  />
                </dl>
                {report.tenders.unverifiedCollectedCents > 0 && (
                  <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                    Unverified tenders (QR, Other) are marked paid by the operator with no cash
                    drawer or payment-processor evidence. Review these against your own records.
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <TableHeading title="Sales by item" exportHref={exportHref("item")} />
            {itemSales.byItem.length === 0 ? (
              <p className="text-sm text-muted-foreground">No items sold this day.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {itemSales.byItem.map((i) => (
                    <tr key={i.name} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-2">{i.name}</td>
                      <td className="numeric py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="numeric py-2 text-right font-semibold">{money(i.netSalesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5">
            <TableHeading title="Sales by category" exportHref={exportHref("category")} />
            {itemSales.byCategory.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales this day.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Category</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {itemSales.byCategory.map((c) => (
                    <tr key={c.category} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-2">{c.category}</td>
                      <td className="numeric py-2 text-right tabular-nums">{c.quantity}</td>
                      <td className="numeric py-2 text-right font-semibold">{money(c.netSalesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <CardContent className="p-5">
            <TableHeading title="Sales by cashier" exportHref={exportHref("cashier")} />
            {cashierSales.length === 0 ? (
              <p className="text-sm text-muted-foreground">No sales this day.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Cashier</th>
                    <th className="pb-2 text-right font-medium">Orders</th>
                    <th className="pb-2 text-right font-medium">Net sales</th>
                  </tr>
                </thead>
                <tbody>
                  {cashierSales.map((c) => (
                    <tr key={c.cashier} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-2">{c.cashier}</td>
                      <td className="numeric py-2 text-right tabular-nums">{c.orderCount}</td>
                      <td className="numeric py-2 text-right font-semibold">{money(c.netSalesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function TableHeading({ title, exportHref }: { title: string; exportHref: string }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <h2 className="text-lg font-bold">{title}</h2>
      <a
        href={exportHref}
        download
        className={buttonVariants({ variant: "ghost", size: "sm" })}
      >
        Export CSV
      </a>
    </div>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{title}</p>
        <p className="numeric mt-1 text-2xl font-black">{value}</p>
      </CardContent>
    </Card>
  );
}

function RowDl({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`numeric ${strong ? "font-black" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
