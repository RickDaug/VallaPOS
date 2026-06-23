import "server-only";

import { db } from "@/lib/db";
import {
  validateGroupSelection,
  type PricedLineInput,
  type ResolvedModifier,
  type GroupConstraint,
} from "./pricing";

/**
 * Shared, server-authoritative resolution of order lines from client input. Used
 * by BOTH the store checkout (register/actions.ts) and the restaurant tab adds
 * (tabs/actions.ts): it re-looks-up real variation prices + each item's linked
 * modifier groups from the DB (scoped to the business), validates the chosen
 * modifiers against min/maxSelect, and returns price-engine inputs plus the
 * snapshotted records to persist. The client never sets prices or names.
 */

export interface LineInput {
  variationId: string;
  quantity: number;
  lineDiscountCents?: number;
  modifierIds?: string[];
}

export interface ResolvedLine {
  variationId: string;
  unitPriceCents: number;
  quantity: number;
  lineDiscountCents: number;
  modifiers: ResolvedModifier[];
  nameSnapshot: string;
}

export async function resolveOrderLines(
  businessId: string,
  lines: LineInput[],
): Promise<{ moneyLines: PricedLineInput[]; lineRecords: ResolvedLine[] }> {
  const variations = await db.variation.findMany({
    where: { businessId, id: { in: lines.map((l) => l.variationId) } },
    include: {
      item: {
        select: {
          name: true,
          modifierLinks: {
            select: {
              group: {
                select: {
                  id: true,
                  minSelect: true,
                  maxSelect: true,
                  modifiers: { select: { id: true, name: true, priceDeltaCents: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  const byId = new Map(variations.map((v) => [v.id, v]));

  const moneyLines: PricedLineInput[] = [];
  const lineRecords: ResolvedLine[] = lines.map((line) => {
    const variation = byId.get(line.variationId);
    if (!variation) throw new Error(`Unknown item: ${line.variationId}`);
    const unitPriceCents = variation.priceCents;

    const chosenIds = line.modifierIds ?? [];
    const groups = variation.item.modifierLinks.map((l) => l.group);
    const modifierById = new Map<string, ResolvedModifier>();
    for (const g of groups) {
      for (const m of g.modifiers) {
        modifierById.set(m.id, { id: m.id, nameSnapshot: m.name, priceDeltaCents: m.priceDeltaCents });
      }
    }

    // Any chosen id must belong to one of this item's linked groups.
    for (const id of chosenIds) {
      if (!modifierById.has(id)) throw new Error(`Unknown modifier for item: ${id}`);
    }

    // Validate every group's selection (covers required-group-left-empty too).
    for (const g of groups) {
      const groupModifierIds = g.modifiers.map((m) => m.id);
      const chosenInGroup = chosenIds.filter((id) => groupModifierIds.includes(id));
      const constraint: GroupConstraint = {
        groupId: g.id,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        modifierIds: groupModifierIds,
      };
      validateGroupSelection(constraint, chosenInGroup);
    }

    const chosenModifiers = chosenIds.map((id) => modifierById.get(id)!);
    const lineDiscountCents = line.lineDiscountCents ?? 0;

    moneyLines.push({
      unitPriceCents,
      quantity: line.quantity,
      lineDiscountCents,
      modifiers: chosenModifiers,
    });

    return {
      variationId: variation.id,
      unitPriceCents,
      quantity: line.quantity,
      lineDiscountCents,
      modifiers: chosenModifiers,
      nameSnapshot:
        variation.name && variation.name !== "Default"
          ? `${variation.item.name} — ${variation.name}`
          : variation.item.name,
    };
  });

  return { moneyLines, lineRecords };
}
