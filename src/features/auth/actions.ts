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
  // Store vs Restaurant, asked at sign-up (audit R2 #7). RESTAURANT unlocks the
  // floor plan + open tabs. Field already exists on Business — no migration.
  mode: z.enum(["STORE", "RESTAURANT"]).default("STORE"),
});

/**
 * A single, clearly-labeled demo product seeded into every new business so the
 * register isn't empty on the first visit — the merchant can tap-and-ring it
 * immediately to feel the flow, then delete it (audit R2 #9).
 */
const SAMPLE_ITEM_NAME = "Sample item (tap to sell — delete anytime)";
const SAMPLE_ITEM_PRICE_CENTS = 500;

/**
 * Create a business for the currently-authenticated user and make them OWNER.
 * Called right after client-side sign-up (the session cookie is already set),
 * and from the create-business recovery route for a business-less user.
 */
export async function createBusiness(input: {
  name: string;
  country?: string;
  currency?: string;
  mode?: string;
}): Promise<{ businessId: string }> {
  const session = await requireSession();
  const { name, country, currency, mode } = createBusinessSchema.parse(input);

  const business = await db.business.create({
    data: {
      name,
      country,
      currency,
      mode,
      // A brand-new business is a single operator until staff are added, so it
      // starts "unlocked" — the register doesn't re-lock after every sale, which
      // would otherwise re-authenticate a solo owner before each transaction
      // (audit R2 #1). They can switch to the secure shared-till behavior in
      // Settings once they add a team. This is a create-time data default only.
      singleOperatorMode: true,
      memberships: { create: { userId: session.user.id, role: "OWNER" } },
      orderCounter: { create: {} }, // start the per-business order-number sequence at 0
    },
    select: { id: true },
  });

  // Seed the demo product (own businessId — tenant-scoped write). Non-fatal: if
  // this ever fails the merchant just starts with an empty catalog rather than a
  // broken sign-up.
  await db.item.create({
    data: {
      businessId: business.id,
      name: SAMPLE_ITEM_NAME,
      variations: {
        create: {
          businessId: business.id,
          name: "Default",
          priceCents: SAMPLE_ITEM_PRICE_CENTS,
        },
      },
    },
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
