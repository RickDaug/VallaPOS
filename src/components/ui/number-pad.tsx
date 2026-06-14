"use client";

import { Delete } from "lucide-react";
import { cn } from "@/lib/utils";
import { applyNumpadKey } from "@/features/register/tender";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "back"] as const;

/**
 * Touch number pad for cash entry. Operates on a decimal-dollar string and
 * emits the next value via onChange (keypress logic lives in the tested
 * `applyNumpadKey`). Big targets honor the 44px touch law.
 */
export function NumberPad({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("grid grid-cols-3 gap-2", className)}>
      {KEYS.map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(applyNumpadKey(value, key))}
          aria-label={key === "back" ? "Delete" : key}
          className="flex h-14 items-center justify-center rounded-md border border-border bg-card text-xl font-bold text-foreground transition-colors hover:bg-muted active:scale-[0.98]"
        >
          {key === "back" ? <Delete size={20} /> : key}
        </button>
      ))}
    </div>
  );
}
