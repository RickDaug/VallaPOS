"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Role } from "@prisma/client";
import {
  addMember,
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(fn: () => Promise<unknown>) {
    setError(null);
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
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
        {error && (
          <p className="mt-3 text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4">
          {open ? (
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => run(() => clockOut({ businessId }))}
            >
              {pending ? "…" : "Clock out"}
            </Button>
          ) : (
            <Button
              variant="success"
              disabled={pending}
              onClick={() => run(() => clockIn({ businessId }))}
            >
              {pending ? "…" : "Clock in"}
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
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("CASHIER");
  const [message, setMessage] = useState<{ kind: "error" | "ok"; text: string } | null>(null);

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await addMember({ businessId, email, role });
        if ("error" in res) {
          const text =
            res.error === "no_such_user"
              ? "No account with that email. They must sign up first, then you can add them."
              : "That person is already a member.";
          setMessage({ kind: "error", text });
          return;
        }
        setEmail("");
        setMessage({ kind: "ok", text: "Member added." });
        router.refresh();
      } catch (err) {
        setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not add member." });
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
          <Button type="submit" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </form>
        {message && (
          <p
            className={`mt-3 text-sm font-medium ${
              message.kind === "error" ? "text-destructive" : "text-success"
            }`}
            role={message.kind === "error" ? "alert" : "status"}
          >
            {message.text}
          </p>
        )}
      </CardContent>
    </Card>
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
  const [pending, startTransition] = useTransition();
  const [pin, setPin] = useState("");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await setMemberPin({ businessId, membershipId: member.membershipId, pin });
        setPin("");
        setEditing(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not set PIN.");
      }
    });
  }

  function clear() {
    setError(null);
    startTransition(async () => {
      try {
        await clearMemberPin({ businessId, membershipId: member.membershipId });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not clear PIN.");
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
        {error && (
          <span className="text-sm text-destructive" role="alert">
            {error}
          </span>
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
        aria-label={`PIN for ${member.name ?? member.email}`}
      />
      <Button type="submit" size="sm" disabled={pending}>
        Save
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => {
          setEditing(false);
          setPin("");
          setError(null);
        }}
      >
        Cancel
      </Button>
      {error && (
        <span className="text-sm text-destructive" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

/** One member row with role / PIN / active controls. */
function MemberCard({ businessId, member }: { businessId: string; member: MemberRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRoleChange(role: Role) {
    setError(null);
    startTransition(async () => {
      try {
        await changeMemberRole({ businessId, membershipId: member.membershipId, role });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not change role.");
      }
    });
  }

  function onActiveToggle() {
    setError(null);
    startTransition(async () => {
      try {
        await setMemberActive({
          businessId,
          membershipId: member.membershipId,
          active: !member.active,
        });
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not update member.");
      }
    });
  }

  return (
    <Card className={member.active ? undefined : "opacity-70"}>
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
            </p>
            <p className="truncate text-sm text-muted-foreground">{member.email}</p>
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
        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/** Manager view: add members + manage roles/PINs/active state. */
export function MemberAdmin({
  businessId,
  members,
}: {
  businessId: string;
  members: MemberRow[];
}) {
  return (
    <div className="space-y-4">
      <AddMemberForm businessId={businessId} />
      <div className="space-y-2">
        {members.map((m) => (
          <MemberCard key={m.membershipId} businessId={businessId} member={m} />
        ))}
      </div>
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
    return <p className="text-sm text-muted-foreground">No time entries today.</p>;
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
