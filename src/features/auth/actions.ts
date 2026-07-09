"use server";

import { z } from "zod";
import { db } from "@/lib/db";
import { allowCrossTenant } from "@/lib/tenant-backstop";
import { requireSession } from "@/lib/tenant";
import { COUNTRY_CODES, CURRENCY_CODES, DEFAULT_REGION } from "@/features/onboarding/regions";

const createBusinessSchema = z.object({
  name: z.string().trim().min(1, "Business name is required").max(80),
  // Where the merchant sells — sets the Connect account country + a default
  // currency for the US + LATAM market (audit #14). Both fields already exist on
  // Business, so this needs no migration. Defaulted so older callers still work.
  country: z.enum(COUNTRY_CODES).default(DEFAULT_REGION.country),
  currency: z.enum(CURRENCY_CODES).default(DEFAULT_REGION.currency),
});

/**
 * Create a business for the currently-authenticated user and make them OWNER.
 * Called right after client-side sign-up (the session cookie is already set),
 * and from the create-business recovery route for a business-less user.
 */
export async function createBusiness(input: {
  name: string;
  country?: string;
  currency?: string;
}): Promise<{ businessId: string }> {
  const session = await requireSession();
  const { name, country, currency } = createBusinessSchema.parse(input);

  const business = await db.business.create({
    data: {
      name,
      country,
      currency,
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
  // id is the isolation boundary here, not businessId. `allowCrossTenant` stands
  // the runtime backstop down for this one reviewed query (the runtime twin of
  // the `// tenant-ok` opt-out above).
  const membership = await allowCrossTenant(() =>
    db.membership.findFirst({
      where: { userId: session.user.id },
      orderBy: { createdAt: "asc" },
      select: { businessId: true },
    }),
  );
  return membership?.businessId ?? null;
}
