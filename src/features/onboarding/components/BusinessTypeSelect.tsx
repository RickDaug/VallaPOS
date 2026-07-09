"use client";

import { Store, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

export type BusinessMode = "STORE" | "RESTAURANT";

const OPTIONS: { value: BusinessMode; label: string; hint: string; Icon: typeof Store }[] = [
  { value: "STORE", label: "Store", hint: "Retail, services, market", Icon: Store },
  { value: "RESTAURANT", label: "Restaurant", hint: "Tables, tabs, floor plan", Icon: UtensilsCrossed },
];

/**
 * "What kind of business?" picker used at sign-up (audit R2 #7). Choosing
 * Restaurant sets Business.mode = RESTAURANT, which unlocks the floor plan + open
 * tabs. Store is the default. mode already exists on Business — no migration.
 */
export function BusinessTypeSelect({
  mode,
  onChange,
}: {
  mode: BusinessMode;
  onChange: (mode: BusinessMode) => void;
}) {
  return (
    <div>
      <Label>What kind of business?</Label>
      <div role="radiogroup" aria-label="Business type" className="grid grid-cols-2 gap-2">
        {OPTIONS.map(({ value, label, hint, Icon }) => {
          const selected = mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(value)}
              className={cn(
                "flex min-h-12 flex-col items-start gap-1 rounded-md border px-3 py-2.5 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-input bg-card text-foreground hover:bg-muted",
              )}
            >
              <span className="flex items-center gap-2 font-semibold">
                <Icon size={18} className={cn(selected ? "text-primary" : "text-muted-foreground")} />
                {label}
              </span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
