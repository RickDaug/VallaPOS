"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";

const CURRENCIES = ["USD", "CAD", "EUR", "GBP", "AUD"] as const;

const updateSettingsSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(1, "Business name is required").max(80),
  // Tax rate stored as basis points; capped at 100% (10000 bps).
  taxRateBps: z.number().int().min(0).max(10_000),
  currency: z.enum(CURRENCIES),
  taxInclusive: z.boolean(),
  // STORE = instant retail checkout; RESTAURANT unlocks the floor plan + open
  // tabs with per-seat split checks.
  mode: z.enum(["STORE", "RESTAURANT"]),
});

export async function updateBusinessSettings(input: z.infer<typeof updateSettingsSchema>) {
  const data = updateSettingsSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_settings");

  await db.business.update({
    where: { id: ctx.businessId },
    data: {
      name: data.name,
      taxRateBps: data.taxRateBps,
      currency: data.currency,
      taxInclusive: data.taxInclusive,
      mode: data.mode,
    },
  });

  // Tax rate / name feed the register, shell, and reports.
  revalidatePath(`/${ctx.businessId}`, "layout");
}
