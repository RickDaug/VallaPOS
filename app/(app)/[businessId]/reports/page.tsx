import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { getDailyReport } from "@/features/orders/queries";
import { getDrawerDaySummary } from "@/features/cash-drawer/queries";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export default async function ReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { businessId } = await params;
  const { date } = await searchParams;
  await requireMembership(businessId);

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  if (!business) notFound();

  const dateStr = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : toDateInput(new Date());
  const start = new Date(`${dateStr}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  const report = await getDailyReport(businessId, start, end);
  const drawer = await getDrawerDaySummary(businessId, start, end);
  const money = (c: number) => formatMoney(c, business.currency);

  return (
    <section>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black md:text-3xl">End-of-day report</h1>
          <p className="text-sm text-muted-foreground">Z-report — sales, tax, and cash for the day.</p>
        </div>
        <form method="get" className="flex items-center gap-2">
          <Input type="date" name="date" defaultValue={dateStr} className="numeric h-11 w-auto" />
          <Button type="submit" size="sm">View</Button>
        </form>
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
    </section>
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
