import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

// tsx doesn't auto-load env files. Pull DATABASE_URL (for Prisma) plus the
// BETTER_AUTH_* / NEXT_PUBLIC_* vars (which `src/lib/env.ts` validates when we
// dynamically import the auth instance below) from .env / .env.local.
for (const file of [".env", ".env.local"]) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (!/^[A-Za-z0-9_]+$/.test(key) || process.env[key] !== undefined) continue;
      process.env[key] = line
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, "");
    }
  } catch {
    // file is optional
  }
}

const db = new PrismaClient();

const DEMO_BUSINESS = "Valla Demo Eats & Cuts";
const OWNER_EMAIL = "owner@valla.test";
const OWNER_PASSWORD = "supersecret123";

/**
 * Demo seed: a test OWNER login plus one business with a small mixed catalog
 * (food + service + burger modifiers) so you can sign in and immediately ring
 * up a sale. Idempotent: deletes the prior demo business (cascade clears its
 * catalog/memberships/orders) and reuses the owner user if it already exists.
 *
 * This DOES touch the configured database — there is only one Neon DB, so the
 * demo data lands alongside real data, but it only ever removes the
 * demo-named business, never your own businesses.
 */
async function main() {
  // 1) Owner login. Better Auth hashes the password + writes the User/Account
  //    rows; reuse the user on re-runs (signUpEmail rejects a duplicate email).
  const existing = await db.user.findUnique({ where: { email: OWNER_EMAIL } });
  let ownerId: string;
  if (existing) {
    ownerId = existing.id;
    console.log(`Reusing existing owner user ${OWNER_EMAIL}.`);
  } else {
    // Imported here (not at top) so the env loading above runs first —
    // src/lib/auth.ts -> src/lib/env.ts throws if the vars are missing.
    const { auth } = await import("../src/lib/auth");
    const res = await auth.api.signUpEmail({
      body: { email: OWNER_EMAIL, password: OWNER_PASSWORD, name: "Demo Owner" },
    });
    ownerId = res.user.id;
    console.log(`Created owner user ${OWNER_EMAIL} / ${OWNER_PASSWORD}.`);
  }

  // 2) Fresh demo business owned by that user (their first membership, so
  //    sign-in routes straight here via getPrimaryBusinessId).
  await db.business.deleteMany({ where: { name: DEMO_BUSINESS } });

  const business = await db.business.create({
    data: {
      name: DEMO_BUSINESS,
      taxRateBps: 825, // 8.25%
      currency: "USD",
      orderCounter: { create: {} }, // per-business order-number sequence
      memberships: { create: { userId: ownerId, role: "OWNER" } },
      categories: {
        create: [
          { name: "Food", sortOrder: 0 },
          { name: "Drinks", sortOrder: 1 },
          { name: "Services", sortOrder: 2 },
        ],
      },
    },
    include: { categories: true },
  });

  const food = business.categories.find((c) => c.name === "Food")!;
  const drinks = business.categories.find((c) => c.name === "Drinks")!;
  const services = business.categories.find((c) => c.name === "Services")!;

  const burger = await db.item.create({
    data: {
      businessId: business.id,
      categoryId: food.id,
      name: "Classic Burger",
      type: "PRODUCT",
      trackStock: false,
      variations: { create: [{ businessId: business.id, name: "Default", priceCents: 999 }] },
    },
  });

  await db.item.create({
    data: {
      businessId: business.id,
      categoryId: drinks.id,
      name: "Soda",
      type: "PRODUCT",
      variations: {
        create: [
          { businessId: business.id, name: "Small", priceCents: 199, sortOrder: 0 },
          { businessId: business.id, name: "Large", priceCents: 299, sortOrder: 1 },
        ],
      },
    },
  });

  await db.item.create({
    data: {
      businessId: business.id,
      categoryId: services.id,
      name: "Line Up",
      type: "SERVICE",
      trackStock: false,
      variations: { create: [{ businessId: business.id, name: "Default", priceCents: 2000 }] },
    },
  });

  // Modifier groups on the burger so the register picker has data to exercise
  // both selection rules: "Cook" is required single-select (minSelect 1, maxSelect 1);
  // "Add-ons" is optional multi-select (minSelect 0, maxSelect 3) with price deltas.
  await db.modifierGroup.create({
    data: {
      businessId: business.id,
      name: "Cook",
      minSelect: 1,
      maxSelect: 1,
      modifiers: {
        create: [
          { businessId: business.id, name: "Rare", priceDeltaCents: 0, sortOrder: 0 },
          { businessId: business.id, name: "Medium", priceDeltaCents: 0, sortOrder: 1 },
          { businessId: business.id, name: "Well done", priceDeltaCents: 0, sortOrder: 2 },
        ],
      },
      itemLinks: { create: [{ itemId: burger.id }] },
    },
  });

  await db.modifierGroup.create({
    data: {
      businessId: business.id,
      name: "Add-ons",
      minSelect: 0,
      maxSelect: 3,
      modifiers: {
        create: [
          { businessId: business.id, name: "Extra cheese", priceDeltaCents: 100, sortOrder: 0 },
          { businessId: business.id, name: "Bacon", priceDeltaCents: 150, sortOrder: 1 },
          { businessId: business.id, name: "Avocado", priceDeltaCents: 200, sortOrder: 2 },
        ],
      },
      itemLinks: { create: [{ itemId: burger.id }] },
    },
  });

  console.log(`Seeded business ${business.id} (${business.name}).`);
  console.log(`Sign in at /sign-in with ${OWNER_EMAIL} / ${OWNER_PASSWORD}.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
