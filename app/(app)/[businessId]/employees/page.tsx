import { requireMembership } from "@/lib/tenant";
import { roleAtLeast } from "@/lib/roles";
import {
  listMembers,
  getTodayTimesheet,
  getOpenEntryFor,
} from "@/features/employees/queries";
import { formatDuration } from "@/features/employees/duration";
import {
  ClockWidget,
  MemberAdmin,
  Timesheet,
} from "@/features/employees/components/EmployeesManager";

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
}

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const ctx = await requireMembership(businessId);
  const canManage = roleAtLeast(ctx.role, "MANAGER");

  const [openEntry, timesheet, members] = await Promise.all([
    getOpenEntryFor(businessId, ctx.membershipId),
    getTodayTimesheet(businessId),
    canManage ? listMembers(businessId) : Promise.resolve([]),
  ]);

  const rows = timesheet.entries.map((e) => ({
    id: e.id,
    label: e.memberName ?? e.memberEmail,
    range: `${fmtTime(e.clockInAt)} → ${e.clockOutAt ? fmtTime(e.clockOutAt) : "now"}`,
    duration: formatDuration(e.durationSeconds),
    open: e.open,
  }));

  return (
    <section className="space-y-10">
      <header>
        <h1 className="text-2xl font-black md:text-3xl">Employees</h1>
        <p className="text-sm text-muted-foreground">
          Clock in and out, and {canManage ? "manage members, roles, and PINs." : "view today's shifts."}
        </p>
      </header>

      <ClockWidget businessId={businessId} open={openEntry} />

      <section>
        <h2 className="mb-3 text-lg font-bold">Today&apos;s shifts</h2>
        <Timesheet rows={rows} totalLabel={formatDuration(timesheet.totalDurationSeconds)} />
      </section>

      {canManage && (
        <section>
          <h2 className="mb-3 text-lg font-bold">Team</h2>
          <MemberAdmin businessId={businessId} members={members} />
        </section>
      )}
    </section>
  );
}
