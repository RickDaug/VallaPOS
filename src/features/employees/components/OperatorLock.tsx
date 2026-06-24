"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Lock, Delete, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { enterOperatorPin, becomeSelfOperator } from "@/features/employees/actions";
import { PIN_MAX_LENGTH } from "@/features/employees/schema";
import type { LockScreenMember } from "@/features/employees/queries";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

/**
 * The device lock / home screen. The device is signed in (owner/manager), but no
 * one can ring up until they identify themselves with a PIN. Picking a member
 * shows a PIN pad; a fresh owner with no PIN yet can "Continue" without one
 * (bootstrap). On success the operator cookie is set and the shell re-renders.
 */
export function OperatorLock({
  businessId,
  businessName,
  members,
  selfMembershipId,
}: {
  businessId: string;
  businessName: string;
  members: LockScreenMember[];
  selfMembershipId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<LockScreenMember | null>(null);
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);

  const self = members.find((m) => m.membershipId === selfMembershipId);
  const canBootstrap = self && !self.hasPin; // owner/manager without a PIN yet

  function press(key: string) {
    setError(null);
    if (key === "back") setPin((p) => p.slice(0, -1));
    else if (/^\d$/.test(key) && pin.length < PIN_MAX_LENGTH) setPin((p) => p + key);
  }

  function submitPin() {
    if (!picked) return;
    startTransition(async () => {
      try {
        const res = await enterOperatorPin({ businessId, membershipId: picked.membershipId, pin });
        if (!res.ok) {
          setError("Wrong PIN. Try again.");
          setPin("");
          return;
        }
        router.refresh();
      } catch {
        setError("Could not sign in.");
      }
    });
  }

  function continueAsSelf() {
    startTransition(async () => {
      try {
        const res = await becomeSelfOperator({ businessId });
        if (!res.ok) {
          setError(res.needsPin ? "Set a PIN and use it to sign in." : "Could not continue.");
          return;
        }
        router.refresh();
      } catch {
        setError("Could not continue.");
      }
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock size={22} />
          </div>
          <h1 className="text-xl font-black">{businessName}</h1>
          <p className="text-sm text-muted-foreground">
            {picked ? `Enter ${picked.name}'s PIN` : "Tap your name to sign in"}
          </p>
        </div>

        {!picked ? (
          <div className="space-y-2">
            {members.filter((m) => m.hasPin).map((m) => (
              <button
                key={m.membershipId}
                type="button"
                onClick={() => {
                  setPicked(m);
                  setPin("");
                  setError(null);
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border bg-card px-4 py-3 text-left font-semibold hover:border-primary/50"
              >
                {m.name}
                <span className="text-xs font-normal text-muted-foreground">{m.role}</span>
              </button>
            ))}
            {members.filter((m) => m.hasPin).length === 0 && !canBootstrap && (
              <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No staff PINs set yet. An owner or manager can add staff and PINs from the Team screen.
              </p>
            )}
            {canBootstrap && (
              <Button className="w-full" disabled={pending} onClick={continueAsSelf}>
                Continue as {self!.name}
              </Button>
            )}
          </div>
        ) : (
          <div>
            <div className="mb-3 flex h-14 items-center justify-center rounded-lg border border-border bg-card text-2xl font-black tracking-[0.3em]">
              {pin.replace(/./g, "•") || <span className="text-base font-normal text-muted-foreground">····</span>}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {KEYS.map((key, i) =>
                key === "" ? (
                  <div key={i} />
                ) : (
                  <button
                    key={i}
                    type="button"
                    onClick={() => press(key)}
                    aria-label={key === "back" ? "Delete" : key}
                    className="flex h-14 items-center justify-center rounded-md border border-border bg-card text-xl font-bold hover:bg-muted active:scale-[0.98]"
                  >
                    {key === "back" ? <Delete size={20} /> : key}
                  </button>
                ),
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setPicked(null)} disabled={pending}>
                <ArrowLeft size={16} /> Back
              </Button>
              <Button className="flex-1" onClick={submitPin} disabled={pending || pin.length < 4}>
                {pending ? "…" : "Sign in"}
              </Button>
            </div>
          </div>
        )}

        {error && (
          <p className="mt-3 text-center text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
