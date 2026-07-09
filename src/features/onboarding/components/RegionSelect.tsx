"use client";

import { Label } from "@/components/ui/label";
import { REGIONS } from "@/features/onboarding/regions";

/**
 * "Where do you sell?" picker used by sign-up and the create-business recovery
 * form. Choosing a region sets both Business.country and a default currency, so
 * a US or LATAM merchant isn't silently defaulted to USD/US (audit #14).
 */
export function RegionSelect({
  country,
  onChange,
}: {
  country: string;
  onChange: (country: string) => void;
}) {
  return (
    <div>
      <Label htmlFor="country">Where do you sell?</Label>
      <select
        id="country"
        value={country}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 w-full rounded-md border border-input bg-card px-4 text-base text-foreground shadow-sm focus-visible:border-ring"
      >
        {REGIONS.map((r) => (
          <option key={r.country} value={r.country}>
            {r.flag} {r.label} · {r.currency}
          </option>
        ))}
      </select>
      <p className="mt-1 text-xs text-muted-foreground">
        Sets your currency. You can fine-tune tax and currency in Settings later.
      </p>
    </div>
  );
}
