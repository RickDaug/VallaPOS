"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";
import { updateSettingsSchema, type UpdateSettingsInput } from "./schema";

export async function updateBusinessSettings(input: UpdateSettingsInput) {
  const data = updateSettingsSchema.parse(input);
  const ctx = await requireCapability(data.businessId, "manage_settings");

  await db.business.update({
    where: { id: ctx.businessId },
    data: {
      name: data.name,
      taxRateBps: data.taxRateBps,
      currency: data.currency,
      timezone: data.timezone,
      taxInclusive: data.taxInclusive,
      mode: data.mode,
      singleOperatorMode: data.singleOperatorMode,
      qrPayEnabled: data.qrPayEnabled,
      qrPayLabel: data.qrPayLabel ?? null,
      qrPayValue: data.qrPayValue ?? null,
    },
  });

  // Tax rate / name feed the register, shell, and reports.
  revalidatePath(`/${ctx.businessId}`, "layout");
}
