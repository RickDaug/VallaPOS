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
  /**
   * AD-HOC modifiers the cashier typed at the order screen (no catalog row). The
   * name + upcharge are cashier-provided (validated + capped by the checkout
   * schema); the upcharge only ADDS (min 0), like a manual line addition. Snapshotted
   * onto the order line the same way catalog modifiers are.
   */
  customModifiers?: { name: string; priceDeltaCents: number }[];
  /**
   * OFFLINE PRICE SNAPSHOT override (deliberate, bounded trust relaxation —
   * see register/actions.ts). Present ONLY when replaying an offline sale whose
   * cash was already collected at a quoted price. When set, the resolver uses
   * the quoted base `unitPriceCents` (and, per modifier id, the quoted delta)
   * INSTEAD of the current catalog price — but it STILL re-looks-up the variation
   * + modifiers to validate they exist and are linked (only the amounts are
   * trusted). Absent on every online checkout, which stays fully authoritative.
   */
  priceOverride?: {
    unitPriceCents: number;
    modifierDeltas?: Record<string, number>;
  };
}

export interface ResolvedLine {
  variationId: string;
  unitPriceCents: number;
  quantity: number;
  lineDiscountCents: number;
  modifiers: ResolvedModifier[];
  nameSnapshot: string;
}

/**
 * OFFLINE PRICE-SNAPSHOT FORGERY FLOOR (Round-3 #5).
 *
 * The offline `priceOverride` is a bounded trust relaxation: a queued sale
 * carries the price the customer was QUOTED, and the device is the only witness.
 * That snapshot is forgeable on a tampered device, so a thief could queue a $10
 * item as $0.01. A full fix (a manager-signed snapshot token) needs device key
 * provisioning + a schema field and isn't possible offline here, so this is the
 * pragmatic mitigation: an overridden unit/modifier price that is IMPLAUSIBLY
 * below the CURRENT catalog price is clamped UP to catalog and the line is
 * flagged (the caller records an auditable marker on the payment). The floor is a
 * FRACTION of catalog rather than an equality check so a LEGITIMATE catalog price
 * RISE (quoted price now below catalog, but within the floor) still replays at
 * the honest quoted price — we only distrust an override that dropped below half.
 *
 * RESIDUAL (documented, accepted): a forger can still underprice DOWN TO the
 * floor (here, to 50% of catalog) undetected, and a genuine sale where the
 * catalog MORE THAN DOUBLED after the sale is clamped up + flagged (rare, and it
 * fails safe toward the merchant). The real fix remains the signed snapshot.
 */
const MIN_SNAPSHOT_FRACTION_OF_CATALOG = 0.5;

/** The trusted amount for a snapshot override: the quoted amount, unless it is
 *  implausibly below the catalog floor, in which case clamp up to catalog. */
function floorTrust(
  quoted: number,
  catalog: number,
): { value: number; clamped: boolean } {
  // A zero/negative catalog reference has no meaningful floor — trust the quote.
  if (catalog <= 0) return { value: quoted, clamped: false };
  const floor = Math.floor(catalog * MIN_SNAPSHOT_FRACTION_OF_CATALOG);
  if (quoted < floor) return { value: catalog, clamped: true };
  return { value: quoted, clamped: false };
}

export async function resolveOrderLines(
  businessId: string,
  lines: LineInput[],
): Promise<{
  moneyLines: PricedLineInput[];
  lineRecords: ResolvedLine[];
  // True when any offline snapshot price was clamped up to catalog because it
  // fell below the forgery floor (see MIN_SNAPSHOT_FRACTION_OF_CATALOG). The
  // register folds this into an auditable marker on the payment reference. Always
  // false for online checkout and the tab flow (no priceOverride is ever set).
  snapshotClamped: boolean;
}> {
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

  let snapshotClamped = false;
  const moneyLines: PricedLineInput[] = [];
  const lineRecords: ResolvedLine[] = lines.map((line) => {
    const variation = byId.get(line.variationId);
    if (!variation) throw new Error(`Unknown item: ${line.variationId}`);
    // OFFLINE PRICE SNAPSHOT: trust the quoted base unit price when replaying an
    // offline sale; otherwise the catalog price is authoritative. A quoted price
    // implausibly below the current catalog is clamped up + flagged (forgery
    // floor — see MIN_SNAPSHOT_FRACTION_OF_CATALOG).
    let unitPriceCents = variation.priceCents;
    if (line.priceOverride) {
      const trust = floorTrust(line.priceOverride.unitPriceCents, variation.priceCents);
      unitPriceCents = trust.value;
      snapshotClamped ||= trust.clamped;
    }

    const chosenIds = line.modifierIds ?? [];
    const groups = variation.item.modifierLinks.map((l) => l.group);
    const modifierById = new Map<string, ResolvedModifier>();
    for (const g of groups) {
      for (const m of g.modifiers) {
        // OFFLINE PRICE SNAPSHOT: when replaying an offline sale, trust the quoted
        // per-modifier delta (the catalog price may have moved since), subject to
        // the same forgery floor. The modifier itself is still validated as
        // existing + linked below.
        const overriddenDelta = line.priceOverride?.modifierDeltas?.[m.id];
        let priceDeltaCents = m.priceDeltaCents;
        if (overriddenDelta !== undefined) {
          const trust = floorTrust(overriddenDelta, m.priceDeltaCents);
          priceDeltaCents = trust.value;
          snapshotClamped ||= trust.clamped;
        }
        modifierById.set(m.id, {
          id: m.id,
          nameSnapshot: m.name,
          priceDeltaCents,
        });
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

    // AD-HOC modifiers: trust the cashier-typed name + upcharge (bounded by the
    // schema; the delta only adds). Synthetic ids keep them distinct in the money
    // engine; only name + delta are persisted (OrderLineModifier has no modifier FK).
    const customModifiers: ResolvedModifier[] = (line.customModifiers ?? []).map((c, i) => ({
      id: `custom_${i}`,
      nameSnapshot: c.name.trim(),
      priceDeltaCents: c.priceDeltaCents,
    }));
    const allModifiers = [...chosenModifiers, ...customModifiers];
    const lineDiscountCents = line.lineDiscountCents ?? 0;

    moneyLines.push({
      unitPriceCents,
      quantity: line.quantity,
      lineDiscountCents,
      modifiers: allModifiers,
    });

    return {
      variationId: variation.id,
      unitPriceCents,
      quantity: line.quantity,
      lineDiscountCents,
      modifiers: allModifiers,
      nameSnapshot:
        variation.name && variation.name !== "Default"
          ? `${variation.item.name} — ${variation.name}`
          : variation.item.name,
    };
  });

  return { moneyLines, lineRecords, snapshotClamped };
}
