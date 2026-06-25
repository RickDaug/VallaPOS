"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users, Clock } from "lucide-react";
import type { Role } from "@prisma/client";
import {
  addMember,
  addStaffMember,
  setMemberPermissions,
  changeMemberRole,
  setMemberPin,
  clearMemberPin,
  setMemberActive,
  clockIn,
  clockOut,
} from "@/features/employees/actions";
import { PIN_MIN_LENGTH, PIN_MAX_LENGTH } from "@/features/employees/schema";
import { formatDuration } from "@/features/employees/duration";
import type { MemberRow } from "@/features/employees/queries";
import { CAPABILITIES, CAPABILITY_LABELS, type Capability } from "@/lib/capabilities";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";

const ROLES: Role[] = ["OWNER", "MANAGER", "CASHIER"];

function roleBadge(role: Role) {
  const variant = role === "OWNER" ? "primary" : role === "MANAGER" ? "success" : "muted";
  return <Badge variant={variant}>{role}</Badge>;
}

/** Self-service clock-in / clock-out widget for the current member. */
export function ClockWidget({
  businessId,
  open,
}: {
  businessId: string;
  open: { id: string; clockInAt: string } | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();

  function run(fn: () => Promise<unknown>, successTitle: string) {
    startTransition(async () => {
      try {
        await fn();
        toast({ title: successTitle, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Something went wrong",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const since = open
    ? new Date(open.clockInAt).toLocaleString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      })
    : null;

  return (
    <Card className="max-w-md">
      <CardContent className="p-5 md:p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">My shift</h2>
          {open ? <Badge variant="success">Clocked in</Badge> : <Badge variant="muted">Off</Badge>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {open ? `On the clock since ${since}.` : "You are not clocked in."}
        </p>
        <div className="mt-4">
          {open ? (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => clockOut({ businessId }), "Clocked out")}
            >
              {pending ? "Clocking out…" : "Clock out"}
            </Button>
          ) : (
            <Button
              variant="success"
              disabled={pending}
              onClick={() => run(() => clockIn({ businessId }), "Clocked in")}
            >
              {pending ? "Clocking in…" : "Clock in"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Add an existing user (by email) to the business. */
function AddMemberForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("CASHIER");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        const res = await addMember({ businessId, email, role });
        if ("error" in res) {
          const description =
            res.error === "no_such_user"
              ? "No account with that email. They must sign up first, then you can add them."
              : "That person is already a member.";
          toast({ title: "Could not add member", description, variant: "error" });
          return;
        }
        setEmail("");
        toast({ title: "Member added", description: email, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not add member",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <h2 className="text-lg font-bold">Add a member</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Add an existing VallaPOS account to this business by email. New users must sign up first.
        </p>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="member-email">Email</Label>
            <Input
              id="member-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="cashier@example.com"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="member-role">Role</Label>
            <select
              id="member-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="flex h-12 w-full rounded-md border border-input bg-card px-3 text-base text-foreground"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending || !email.trim()}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** Add a PIN-only staff member (no email/account) — name + role + PIN. */
function AddStaffForm({ businessId }: { businessId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState("");
  const [role, setRole] = useState<Role>("CASHIER");
  const [pin, setPin] = useState("");

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim();
    startTransition(async () => {
      try {
        await addStaffMember({ businessId, name: trimmedName, role, pin });
        setName("");
        setPin("");
        toast({ title: "Staff member added", description: trimmedName, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not add staff",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  const canSubmit = name.trim().length > 0 && pin.length >= PIN_MIN_LENGTH;

  return (
    <Card>
      <CardContent className="p-5 md:p-6">
        <h2 className="text-lg font-bold">Add staff (PIN only)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No email or account needed — they sign in on this device with their PIN.
        </p>
        <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <Label htmlFor="staff-name">Name</Label>
            <Input
              id="staff-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sam"
              autoComplete="off"
            />
          </div>
          <div>
            <Label htmlFor="staff-role">Role</Label>
            <select
              id="staff-role"
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              className="flex h-12 w-full rounded-md border border-input bg-card px-3 text-base text-foreground"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="staff-pin">PIN ({PIN_MIN_LENGTH}–{PIN_MAX_LENGTH} digits)</Label>
            <Input
              id="staff-pin"
              inputMode="numeric"
              autoComplete="off"
              value={pin}
              maxLength={PIN_MAX_LENGTH}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              placeholder="••••"
              className="numeric w-28"
            />
          </div>
          <Button type="submit" disabled={pending || !canSubmit}>
            {pending ? "Adding…" : "Add staff"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/** OWNER-only granular capability checkboxes for one member. */
function PermissionsEditor({ businessId, member }: { businessId: string; member: MemberRow }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const granted = new Set(member.permissions);

  if (member.role === "OWNER") {
    return <p className="text-xs text-muted-foreground">Owners have full access.</p>;
  }

  function toggle(cap: Capability) {
    const next = new Set(granted);
    if (next.has(cap)) next.delete(cap);
    else next.add(cap);
    startTransition(async () => {
      try {
        await setMemberPermissions({ businessId, membershipId: member.membershipId, permissions: [...next] });
        toast({ title: "Permissions updated", variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not update permissions",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">Can access</p>
      <div className="flex flex-wrap gap-1.5">
        {CAPABILITIES.map((cap) => {
          const on = granted.has(cap);
          return (
            <button
              key={cap}
              type="button"
              disabled={pending}
              aria-pressed={on}
              onClick={() => toggle(cap)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors active:scale-[0.98] disabled:opacity-60 ${
                on ? "border-primary bg-primary/10 text-foreground" : "border-input text-muted-foreground hover:bg-muted"
              }`}
            >
              {CAPABILITY_LABELS[cap]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** PIN set/reset/clear control for one member. */
function PinControl({
  businessId,
  member,
}: {
  businessId: string;
  member: MemberRow;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);

  const who = member.name ?? member.email ?? "member";

  function save(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await setMemberPin({ businessId, membershipId: member.membershipId, pin });
        setPin("");
        setEditing(false);
        toast({ title: "PIN set", description: who, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not set PIN",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function clear() {
    startTransition(async () => {
      try {
        await clearMemberPin({ businessId, membershipId: member.membershipId });
        toast({ title: "PIN cleared", description: who, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not clear PIN",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant={member.hasPin ? "primary" : "muted"}>
          {member.hasPin ? "PIN set" : "No PIN"}
        </Badge>
        <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
          {member.hasPin ? "Reset PIN" : "Set PIN"}
        </Button>
        {member.hasPin && (
          <Button size="sm" variant="ghost" disabled={pending} onClick={clear}>
            Clear
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={save} className="flex items-center gap-2">
      <Input
        inputMode="numeric"
        autoComplete="off"
        value={pin}
        onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_MAX_LENGTH))}
        placeholder={`${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits`}
        className="numeric h-10 w-40"
        autoFocus
        aria-label={`PIN for ${who}`}
      />
      <Button type="submit" size="sm" disabled={pending || pin.length < PIN_MIN_LENGTH}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => {
          setEditing(false);
          setPin("");
        }}
      >
        Cancel
      </Button>
    </form>
  );
}

/** One member row with role / PIN / active controls. */
function MemberCard({
  businessId,
  member,
  canEditPermissions,
}: {
  businessId: string;
  member: MemberRow;
  canEditPermissions: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, startTransition] = useTransition();
  const who = member.name ?? member.email ?? "member";

  function onRoleChange(role: Role) {
    startTransition(async () => {
      try {
        await changeMemberRole({ businessId, membershipId: member.membershipId, role });
        toast({ title: "Role updated", description: `${who} is now ${role}`, variant: "success" });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not change role",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  function onActiveToggle() {
    const nextActive = !member.active;
    startTransition(async () => {
      try {
        await setMemberActive({
          businessId,
          membershipId: member.membershipId,
          active: nextActive,
        });
        toast({
          title: nextActive ? "Member reactivated" : "Member deactivated",
          description: who,
          variant: "success",
        });
        router.refresh();
      } catch (err) {
        toast({
          title: "Could not update member",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      }
    });
  }

  return (
    <Card className={member.active ? "transition-opacity" : "opacity-70 transition-opacity"}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">
              {member.name ?? member.email}
              {member.clockedIn && (
                <span className="ml-2 align-middle">
                  <Badge variant="success">On clock</Badge>
                </span>
              )}
              {!member.active && (
                <span className="ml-2 align-middle">
                  <Badge variant="destructive">Inactive</Badge>
                </span>
              )}
              {member.accountless && (
                <span className="ml-2 align-middle">
                  <Badge variant="muted">PIN only</Badge>
                </span>
              )}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {member.email ?? (member.accountless ? "No login account" : "")}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {roleBadge(member.role)}
            <select
              value={member.role}
              disabled={pending}
              onChange={(e) => onRoleChange(e.target.value as Role)}
              className="h-10 rounded-md border border-input bg-card px-2 text-sm text-foreground"
              aria-label={`Role for ${member.name ?? member.email}`}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <PinControl businessId={businessId} member={member} />
          <Button
            size="sm"
            variant={member.active ? "outline" : "secondary"}
            disabled={pending}
            onClick={onActiveToggle}
          >
            {member.active ? "Deactivate" : "Reactivate"}
          </Button>
        </div>
        {canEditPermissions && (
          <div className="border-t border-border pt-3">
            <PermissionsEditor businessId={businessId} member={member} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Manager view: add members + manage roles/PINs/active state/permissions. */
export function MemberAdmin({
  businessId,
  members,
  canEditPermissions,
}: {
  businessId: string;
  members: MemberRow[];
  canEditPermissions: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <AddStaffForm businessId={businessId} />
        <AddMemberForm businessId={businessId} />
      </div>
      {members.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-1 p-8 text-center">
            <Users className="mb-1 text-muted-foreground" size={28} aria-hidden />
            <p className="font-semibold">No team members yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Add staff with a PIN to ring up on this device, or invite an existing VallaPOS account by email.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {members.map((m) => (
            <MemberCard
              key={m.membershipId}
              businessId={businessId}
              member={m}
              canEditPermissions={canEditPermissions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Read-only today's timesheet rows + total. */
export function Timesheet({
  rows,
  totalLabel,
}: {
  rows: { id: string; label: string; range: string; duration: string; open: boolean }[];
  totalLabel: string;
}) {
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-1 p-8 text-center">
          <Clock className="mb-1 text-muted-foreground" size={26} aria-hidden />
          <p className="font-semibold">No time entries today</p>
          <p className="text-sm text-muted-foreground">Shifts clocked in today will show up here.</p>
        </CardContent>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <Card key={r.id}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="font-semibold">
                {r.label}
                {r.open && (
                  <span className="ml-2 align-middle">
                    <Badge variant="success">Open</Badge>
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">{r.range}</p>
            </div>
            <span className="numeric font-semibold">{r.duration}</span>
          </CardContent>
        </Card>
      ))}
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-sm font-medium text-muted-foreground">Total today</span>
        <span className="numeric font-black">{totalLabel}</span>
      </div>
    </div>
  );
}

export { formatDuration };
