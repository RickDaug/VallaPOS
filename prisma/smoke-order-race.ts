/**
 * Concurrency smoke test for the per-business order-number allocator.
 *
 * Proves the OrderCounter fix: fires N parallel transactions that each allocate
 * the next number exactly the way `checkout()` does, then asserts the results
 * are unique and contiguous (1..N) — i.e. no two concurrent cashiers collided.
 *
 * Run after the migration is applied:
 *   npx tsx prisma/smoke-order-race.ts
 *
 * Uses a throwaway business that is deleted afterwards (cascade removes the
 * counter). Safe on the dev DB.
 */
import { readFileSync } from "node:fs";

// tsx doesn't auto-load env files; pull DATABASE_URL from .env / .env.local.
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

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const N = 50;

async function main() {
  const business = await db.business.create({
    data: { name: `__race-test-${Date.now()}`, orderCounter: { create: {} } },
    select: { id: true },
  });

  try {
    // Same allocation path as checkout(), run N times concurrently.
    const allocate = () =>
      db.$transaction(async (tx) => {
        const counter = await tx.orderCounter.upsert({
          where: { businessId: business.id },
          create: { businessId: business.id, lastNumber: 1 },
          update: { lastNumber: { increment: 1 } },
          select: { lastNumber: true },
        });
        return counter.lastNumber;
      });

    const numbers = await Promise.all(Array.from({ length: N }, allocate));
    const unique = new Set(numbers);
    const expected = new Set(Array.from({ length: N }, (_, i) => i + 1));
    const sorted = [...numbers].sort((a, b) => a - b);

    const allUnique = unique.size === N;
    const contiguous = [...expected].every((n) => unique.has(n));

    console.log(`Allocated ${N} numbers concurrently.`);
    console.log(`  unique:     ${unique.size}/${N} ${allUnique ? "✓" : "✗ DUPLICATES"}`);
    console.log(`  contiguous: ${contiguous ? "✓ 1.." + N : "✗ gaps/overlap"}`);
    console.log(`  range:      ${sorted[0]}..${sorted[N - 1]}`);

    if (!allUnique || !contiguous) {
      console.error("FAIL: order numbers are not unique+contiguous under concurrency.");
      process.exitCode = 1;
    } else {
      console.log("PASS: no collisions — atomic counter holds under concurrency.");
    }
  } finally {
    await db.business.delete({ where: { id: business.id } });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
