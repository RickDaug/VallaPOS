import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

/**
 * Demo seed: one business with a small mixed catalog (food + service) so the
 * register has something to ring up in development. Idempotent-ish: clears the
 * demo business first. Do NOT run against production.
 */
async function main() {
  const business = await db.business.create({
    data: {
      name: "Valla Demo Eats & Cuts",
      taxRateBps: 825, // 8.25%
      currency: "USD",
      orderCounter: { create: {} }, // per-business order-number sequence
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
