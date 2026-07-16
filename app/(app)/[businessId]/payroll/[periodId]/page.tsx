import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { pageHasCapability } from "@/lib/operator-guard";
import { NoAccess } from "@/components/no-access";
import { formatMoney } from "@/lib/money";
import { getPayPeriodDetail } from "@/features/payroll/queries";
import { formatMinutes } from "@/features/payroll/calc";
import { PeriodActions, AdjustmentEditor } from "@/features/payroll/components/PeriodDetail";
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

export default async function PayPeriodPage({
  params,
}: {
  params: Promise<{ businessId: string; periodId: string }>;
}) {
  const { businessId, periodId } = await params;
  await requireMembership(businessId);
  if (!(await pageHasCapability(businessId, "manage_payroll"))) return <NoAccess what="payroll" />;

  const [business, detail] = await Promise.all([
    db.business.findUnique({ where: { id: businessId }, select: { currency: true } }),
    getPayPeriodDetail(businessId, periodId),
  ]);
  if (!business) notFound();
  if (!detail) notFound();

  const money = (c: number) => formatMoney(c, business.currency);
  const editable = detail.status === "DRAFT";
  // endDate is the exclusive window end; show the inclusive last day.
  const lastDay = new Date(new Date(detail.endDate).getTime() - 1).toISOString();
  const rangeLabel = `${fmtDay(detail.startDate)} – ${fmtDay(lastDay)}`;
  const hasOpenShifts = detail.payslips.some((s) => s.openShiftCount > 0);

  return (
    <section className="space-y-8">
      <div>
        <Link
          href={`/${businessId}/payroll`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={15} /> Payroll
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black md:text-3xl">
            {detail.label ?? rangeLabel}
            <Badge variant={statusVariant(detail.status)} className="ml-3 align-middle">
              {detail.status}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">{rangeLabel}</p>
        </div>
      </header>

      <PeriodActions
        businessId={businessId}
        periodId={detail.id}
        status={detail.status}
        hasPayslips={detail.payslips.length > 0}
      />

      <PayrollTaxNotice />

      {detail.payslips.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No payslips yet. {editable ? 'Click "Compute payslips" to pull hours from clock-ins for workers with a pay rate.' : ""}
        </p>
      ) : (
        <>
          {hasOpenShifts && (
            <p className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
              Some workers have an open (not clocked-out) shift. Those hours are measured up to when
              you computed this run — clock them out and recompute for final numbers.
            </p>
          )}

          <div className="space-y-3">
            {detail.payslips.map((s) => (
              <Card key={s.id}>
                <CardContent className="space-y-4 p-4 md:p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold">
                        {s.nameSnapshot}
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          {s.payType === "SALARY" ? "Salary" : "Hourly"}
                        </span>
                      </p>
                      <p className="numeric text-sm text-muted-foreground">
                        {s.payType === "SALARY"
                          ? `${money(s.annualCents)}/yr · ${formatMinutes(s.regularMinutes)} worked`
                          : `${money(s.hourlyCents)}/hr · ${formatMinutes(s.regularMinutes)} reg` +
                            (s.overtimeMinutes > 0
                              ? ` · ${formatMinutes(s.overtimeMinutes)} OT @ ${(s.otMultiplierBps / 10000).toFixed(2)}×`
                              : "")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="numeric text-lg font-black">{money(s.netCents)}</p>
                      <p className="text-xs text-muted-foreground">net</p>
                    </div>
                  </div>

                  <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <Stat label="Regular" value={money(s.regularPayCents)} />
                    <Stat label="Overtime" value={money(s.overtimePayCents)} />
                    <Stat label="Gross" value={money(s.grossCents)} strong />
                    <Stat
                      label="Adjustments"
                      value={`+${money(s.additionsCents)} / −${money(s.deductionsCents)}`}
                    />
                  </dl>

                  <div className="border-t border-border pt-3">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Adjustments
                    </p>
                    <AdjustmentEditor
                      businessId={businessId}
                      payslipId={s.id}
                      adjustments={s.adjustments}
                      editable={editable}
                      money={money}
                    />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 md:p-5">
              <p className="font-bold">Pay run total</p>
              <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <Stat label="Gross" value={money(detail.totals.grossCents)} />
                <Stat label="Additions" value={money(detail.totals.additionsCents)} />
                <Stat label="Deductions" value={money(detail.totals.deductionsCents)} />
                <Stat label="Net" value={money(detail.totals.netCents)} strong />
              </dl>
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`numeric ${strong ? "font-black" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
