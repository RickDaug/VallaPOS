import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireMembership } from "@/lib/tenant";
import { roleAtLeast } from "@/lib/roles";
import { getRunningExpected, listDrawerSessions } from "@/features/cash-drawer/queries";
import { pageHasCapability } from "@/lib/operator-guard";
import { NoAccess } from "@/components/no-access";
import { formatMoney } from "@/lib/money";
import {
  OpenDrawerForm,
  CloseDrawerForm,
  VarianceBadge,
} from "@/features/cash-drawer/components/DrawerManager";
import { Card, CardContent } from "@/components/ui/card";

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default async function DrawerPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { role } = await requireMembership(businessId);
  if (!(await pageHasCapability(businessId, "cash_drawer"))) return <NoAccess what="the cash drawer" />;

  const business = await db.business.findUnique({
    where: { id: businessId },
    select: { currency: true },
  });
  if (!business) notFound();
  const money = (c: number) => formatMoney(c, business.currency);

  const open = await getRunningExpected(businessId);
  const sessions = await listDrawerSessions(businessId);
  const canReconcile = roleAtLeast(role, "MANAGER");

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Cash drawer</h1>
        <p className="text-sm text-muted-foreground">
          Open a drawer with a starting float, then count it down and reconcile against expected
          cash at close.
        </p>
      </header>

      {open ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="max-w-md">
            <CardContent className="p-5 md:p-6">
              <h2 className="text-lg font-bold">Open session</h2>
              <dl className="mt-4 space-y-2 text-sm">
                <Row label="Opened by" value={open.session.openedByName ?? "—"} />
                <Row label="Opened" value={fmtDateTime(open.session.openedAt)} />
                <Row label="Opening float" value={money(open.session.openingFloatCents)} />
                <Row label="Cash collected" value={money(open.cashCollectedCents)} />
                <div className="border-t border-border pt-2">
                  <Row label="Expected in drawer" value={money(open.expectedCents)} strong />
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted-foreground">
                Expected = opening float + cash sales since open. Updates as sales ring up.
              </p>
            </CardContent>
          </Card>

          <CloseDrawerForm
            businessId={businessId}
            sessionId={open.session.id}
            openingFloatCents={open.session.openingFloatCents}
            runningExpectedCents={open.expectedCents}
            canReconcile={canReconcile}
            money={money}
          />
        </div>
      ) : (
        <OpenDrawerForm businessId={businessId} money={money} />
      )}

      <section className="mt-10">
        <h2 className="mb-3 text-lg font-bold">Recent sessions</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drawer sessions yet.</p>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <Card key={s.id}>
                <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="font-semibold">
                      {s.openedByName ?? "—"}
                      <span className="ml-2 text-sm font-normal text-muted-foreground">
                        {fmtDateTime(s.openedAt)}
                        {s.closedAt ? ` → ${fmtDateTime(s.closedAt)}` : " · open"}
                      </span>
                    </p>
                    <p className="numeric text-sm text-muted-foreground">
                      Float {money(s.openingFloatCents)}
                      {s.expectedCents !== null && ` · expected ${money(s.expectedCents)}`}
                      {s.countedCents !== null && ` · counted ${money(s.countedCents)}`}
                    </p>
                  </div>
                  {s.closedAt === null ? (
                    <VarianceBadgeOpen />
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="numeric text-sm font-semibold">
                        {s.varianceCents !== null && s.varianceCents !== 0
                          ? `${s.varianceCents > 0 ? "+" : "−"}${money(Math.abs(s.varianceCents))}`
                          : money(0)}
                      </span>
                      <VarianceBadge varianceCents={s.varianceCents ?? 0} />
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}

function VarianceBadgeOpen() {
  return (
    <span className="rounded-full bg-primary/15 px-2.5 py-0.5 text-xs font-semibold text-primary">
      Open
    </span>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={`numeric ${strong ? "font-black" : "font-semibold"}`}>{value}</dd>
    </div>
  );
}
