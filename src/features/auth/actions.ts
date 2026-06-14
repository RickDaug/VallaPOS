"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/tenant";

const createBusinessSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(80),
});

/**
 * Create a business for the currently-authenticated user and make them OWNER.
 * Called right after client-side sign-up (the session cookie is already set).
 */
export async function createBusiness(input: { name: string }): Promise<{ businessId: string }> {
  const session = await requireSession();
  const { name } = createBusinessSchema.parse(input);

  const business = await db.business.create({
    data: {
      name,
      memberships: { create: { userId: session.user.id, role: "OWNER" } },
      orderCounter: { create: {} }, // start the per-business order-number sequence at 0
    },
    select: { id: true },
  });

  return { businessId: business.id };
}

/** The current user's first business (used to route after sign-in). */
export async function getPrimaryBusinessId(): Promise<string | null> {
  const session = await requireSession();
  // tenant-ok: intentionally cross-business. Before sign-in routing there is no
  // active businessId to scope by — we look up which business(es) THIS
  // authenticated user belongs to, filtered by their own userId. The user's own
  // id is the isolation boundary here, not businessId.
  const membership = await db.membership.findFirst({
    where: { userId: session.user.id },
    orderBy: { createdAt: "asc" },
    select: { businessId: true },
  });
  return membership?.businessId ?? null;
}
