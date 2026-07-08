import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Covers the ad-hoc (cashier-typed) modifier path in resolveOrderLines: custom
 * modifiers are appended to the line with their trusted name + upcharge and flow
 * into the money engine, while catalog modifiers still re-resolve from the DB.
 */
const variationFindMany = vi.fn();
vi.mock("@/lib/db", () => ({
  db: { variation: { findMany: (...a: unknown[]) => variationFindMany(...a) } },
}));

import { resolveOrderLines } from "./resolve-lines";

const BIZ = "biz_1";

function variation(overrides: Record<string, unknown> = {}) {
  return {
    id: "var_1",
    name: "Default",
    priceCents: 999,
    item: { name: "Burger", modifierLinks: [] },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveOrderLines — custom modifiers", () => {
  it("appends cashier-typed modifiers with their name + upcharge", async () => {
    variationFindMany.mockResolvedValue([variation()]);

    const { moneyLines, lineRecords } = await resolveOrderLines(BIZ, [
      {
        variationId: "var_1",
        quantity: 1,
        customModifiers: [
          { name: "No onion", priceDeltaCents: 0 },
          { name: "Extra cheese", priceDeltaCents: 75 },
        ],
      },
    ]);

    expect(lineRecords[0]!.unitPriceCents).toBe(999);
    expect(lineRecords[0]!.modifiers.map((m) => ({ n: m.nameSnapshot, p: m.priceDeltaCents }))).toEqual([
      { n: "No onion", p: 0 },
      { n: "Extra cheese", p: 75 },
    ]);
    // The money engine sees the upcharge too.
    expect((moneyLines[0]!.modifiers ?? []).reduce((a, m) => a + m.priceDeltaCents, 0)).toBe(75);
  });

  it("still rejects an unknown CATALOG modifier id (custom path doesn't loosen that)", async () => {
    variationFindMany.mockResolvedValue([variation()]);
    await expect(
      resolveOrderLines(BIZ, [{ variationId: "var_1", quantity: 1, modifierIds: ["nope"] }]),
    ).rejects.toThrow(/Unknown modifier/);
  });

  it("combines a catalog modifier and a custom one on the same line", async () => {
    variationFindMany.mockResolvedValue([
      variation({
        item: {
          name: "Burger",
          modifierLinks: [
            {
              group: {
                id: "g1",
                minSelect: 0,
                maxSelect: 5,
                modifiers: [{ id: "m1", name: "Bacon", priceDeltaCents: 150 }],
              },
            },
          ],
        },
      }),
    ]);

    const { lineRecords } = await resolveOrderLines(BIZ, [
      {
        variationId: "var_1",
        quantity: 1,
        modifierIds: ["m1"],
        customModifiers: [{ name: "No pickles", priceDeltaCents: 0 }],
      },
    ]);

    const names = lineRecords[0]!.modifiers.map((m) => m.nameSnapshot);
    expect(names).toEqual(["Bacon", "No pickles"]);
  });
});
