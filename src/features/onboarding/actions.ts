"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireCapability } from "@/lib/operator-guard";

/**
 * Read whether the business "stays unlocked" (single-operator mode). Used by the
 * first-run onboarding card so a solo owner can find and confirm the setting
 * without digging into Settings (audit R2 #1b). Scoped to the caller's own
 * business via requireCapability.
 */
export async function getSingleOperatorMode(businessId: string): Promise<boolean> {
  const ctx = await requireCapability(businessId, "manage_settings");
  const business = await db.business.findUnique({
    where: { id: ctx.businessId },
    select: { singleOperatorMode: true },
  });
  return business?.singleOperatorMode ?? false;
}

/**
 * Turn "stay unlocked" (single-operator mode) on or off from the first-run
 * onboarding card (audit R2 #1b). Same capability gate + revalidation as the
 * Settings form so the register picks up the change immediately.
 */
export async function setSingleOperatorMode(
  businessId: string,
  value: boolean,
): Promise<{ singleOperatorMode: boolean }> {
  const ctx = await requireCapability(businessId, "manage_settings");
  await db.business.update({
    where: { id: ctx.businessId },
    data: { singleOperatorMode: value },
  });
  // Feeds the register's lock behavior + the shell.
  revalidatePath(`/${ctx.businessId}`, "layout");
  return { singleOperatorMode: value };
}
