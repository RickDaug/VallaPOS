"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { cn } from "@/lib/utils";
import { lockOperator } from "@/features/employees/actions";

const IDLE_MS = 90_000; // auto-lock after this much inactivity

/**
 * Shows the active operator and a Lock button (switch user), and auto-locks the
 * device after a period of inactivity — so the next worker must enter their PIN.
 * Combined with the post-sale lock, this is the "enter your PIN each time" gate.
 */
export function OperatorBar({
  businessId,
  operatorName,
  className,
}: {
  businessId: string;
  operatorName: string;
  className?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const lock = useRef(() => {});
  lock.current = () => {
    startTransition(async () => {
      try {
        await lockOperator({ businessId });
        router.refresh();
      } catch {
        /* best effort */
      }
    });
  };

  // Idle auto-lock: reset a timer on user activity; fire lock when it elapses.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => lock.current(), IDLE_MS);
    };
    const events = ["pointerdown", "keydown", "visibilitychange"] as const;
    for (const e of events) window.addEventListener(e, reset);
    reset();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, reset);
    };
  }, []);

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => lock.current()}
      aria-label="Lock / switch user"
      className={cn(
        "inline-flex h-11 items-center gap-2 rounded-md px-3 text-sm font-medium text-sidebar-muted hover:bg-sidebar-accent hover:text-sidebar-foreground",
        className,
      )}
    >
      <LockKeyhole size={16} />
      <span className="max-w-24 truncate">{operatorName}</span>
    </button>
  );
}
