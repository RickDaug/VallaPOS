import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { pageHasCapability } from "@/lib/operator-guard";
import { NoAccess } from "@/components/no-access";
import { formatMoney } from "@/lib/money";
import { listPayPeriods, listPayRates } from "@/features/payroll/queries";
import { CreatePeriodForm } from "@/features/payroll/components/CreatePeriodForm";
import { PayRatePanel } from "@/features/payroll/components/PayRatePanel";
import { PayrollTaxNotice } from "@/features/payroll/components/PayrollTaxNotice";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function statusVariant(status: string): "default" | "success" | "warning" {
  if (status === "PAID") return "success";
  if (status === "FINALIZED") return "warning";
  return "default";
}

export default async function PayrollPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  await requireMembership(businessId);
  if (!(await pageHasCapability(businessId, "manage_payroll"))) return <NoAccess what="payroll" />;

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  if (!business) notFound();
  const money = (c: number) => formatMoney(c, business.currency);

  const [periods, rates] = await Promise.all([
    listPayPeriods(businessId),
    listPayRates(businessId),
  ]);

  return (
    <section className="space-y-10">
      <header>
        <h1 className="text-2xl font-black md:text-3xl">Payroll</h1>
        <p className="text-sm text-muted-foreground">
          Turn clocked hours + pay rates into reviewable, exportable pay runs.
        </p>
      </header>

      <PayrollTaxNotice />

      <section className="space-y-4">
        <h2 className="text-lg font-bold">Pay periods</h2>
        {periods.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No pay periods yet. Create one below to compute payslips from clocked hours.
          </p>
        ) : (
          <div className="space-y-2">
            {periods.map((p) => {
              const rangeLabel = `${fmtDay(p.startDate)} – ${fmtDay(
                new Date(new Date(p.endDate).getTime() - 1).toISOString(),
              )}`;
              return (
                <Link key={p.id} href={`/${businessId}/payroll/${p.id}`} className="block">
                  <Card className="transition-shadow hover:shadow-md">
                    <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {p.label ?? rangeLabel}
                          <Badge variant={statusVariant(p.status)} className="ml-2">
                            {p.status}
                          </Badge>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {p.label ? rangeLabel : null}
                          {p.label ? " · " : ""}
                          {p.payslipCount} {p.payslipCount === 1 ? "payslip" : "payslips"}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="numeric font-black">{money(p.netCents)}</p>
                        <p className="text-xs text-muted-foreground">net</p>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
        <CreatePeriodForm businessId={businessId} />
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-bold">Pay rates</h2>
          <p className="text-sm text-muted-foreground">
            Set each worker&apos;s hourly rate or annual salary. Overtime (default 40h/week @ 1.5×)
            applies to hourly workers.
          </p>
        </div>
        <PayRatePanel businessId={businessId} rows={rates} />
      </section>
    </section>
  );
}
