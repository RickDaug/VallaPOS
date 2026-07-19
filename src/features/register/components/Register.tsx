"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CloudOff,
  Delete,
  LayoutGrid,
  List,
  Lock,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Star,
  TriangleAlert,
  Volume2,
  VolumeX,
  WifiOff,
} from "lucide-react";
import { PIN_MIN_LENGTH, PIN_MAX_LENGTH } from "@/features/employees/schema";
import { formatMoney } from "@/lib/money";
import { lockOperator, getActiveOperatorId } from "@/features/employees/actions";
import { computePricedOrder, type PricedLineInput } from "@/features/register/pricing";
import type { SellableEntry, SellableModifierGroup } from "@/features/catalog/queries";
import { stockStatus } from "@/features/catalog/stock";
import { QRCodeSVG } from "qrcode.react";
import type { Receipt, TenderMethod } from "@/features/register/schema";
import {
  createStripeQrSale,
  getStripeQrSaleState,
} from "@/features/payments/sale-actions";

/** Merchant-configured QR payment (confirm-based). null when not enabled. */
type QrPayConfig = { label: string | null; value: string };
import { useOfflineCheckout } from "@/lib/offline/use-offline-checkout";
import {
  type Density,
  FAVORITES_PSEUDO_CATEGORY,
  isFavorite,
  loadDensity,
  loadFavorites,
  saveDensity,
  saveFavorites,
  toggleFavorite,
} from "@/features/register/preferences";
import { NO_TIP, TIP_PERCENTS, tipCentsFor, type TipSelection } from "@/features/register/tip";
import { useTapFeedback } from "@/features/register/use-tap-feedback";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { NumberPad } from "@/components/ui/number-pad";
import { useToast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { quickTenderOptions, dollarsToCents } from "@/features/register/tender";
import { cn } from "@/lib/utils";

type ChosenModifier = { id: string; name: string; priceDeltaCents: number };
type CartLine = {
  // A unique key per (variation + chosen-modifier-set) so two differently
  // modified instances of the same item are distinct cart lines.
  key: string;
  variationId: string;
  label: string;
  priceCents: number;
  qty: number;
  modifiers: ChosenModifier[];
};

/** Stable key for a (variation, chosen modifiers) pair. */
function lineKey(variationId: string, modifierIds: string[]): string {
  return [variationId, ...[...modifierIds].sort()].join("|");
}

// IN-PROGRESS CART PERSISTENCE (Round-3 #1). A half-built cart is client-only
// state; an idle auto-lock (which unmounts the register), a lock/switch, or a
// plain refresh would otherwise discard it. We mirror the cart to localStorage
// keyed per business, restore it on mount, and clear it the moment a sale
// completes / resets — so no lock or reload ever loses a work-in-progress order.
const CART_STORAGE_PREFIX = "vp_cart_";
// Last-known active operator id (captured while ONLINE) so an OFFLINE sale can be
// attributed to the operator who RANG it at replay time (Round-3 #3).
const OPERATOR_ID_STORAGE_PREFIX = "vp_op_id_";

function cartStorageKey(businessId: string): string {
  return `${CART_STORAGE_PREFIX}${businessId}`;
}

function loadStoredCart(businessId: string): CartLine[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(cartStorageKey(businessId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Shape-check defensively — a corrupt/foreign value must never crash the till.
    if (!Array.isArray(parsed)) return null;
    return parsed as CartLine[];
  } catch {
    return null;
  }
}

function saveStoredCart(businessId: string, cart: CartLine[]): void {
  if (typeof window === "undefined") return;
  try {
    if (cart.length === 0) window.localStorage.removeItem(cartStorageKey(businessId));
    else window.localStorage.setItem(cartStorageKey(businessId), JSON.stringify(cart));
  } catch {
    /* storage full / unavailable (private mode) — degrade to non-persistent */
  }
}

function loadStoredOperatorId(businessId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(`${OPERATOR_ID_STORAGE_PREFIX}${businessId}`);
  } catch {
    return null;
  }
}

function saveStoredOperatorId(businessId: string, membershipId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(`${OPERATOR_ID_STORAGE_PREFIX}${businessId}`, membershipId);
  } catch {
    /* best effort */
  }
}

export function Register({
  businessId,
  catalog,
  taxRateBps,
  currency,
  taxInclusive,
  singleOperatorMode,
  qrPay,
  stripeQrEnabled = false,
}: {
  businessId: string;
  catalog: SellableEntry[];
  taxRateBps: number;
  currency: string;
  taxInclusive: boolean;
  singleOperatorMode: boolean;
  qrPay: QrPayConfig | null;
  /** Processor-backed "Card / QR" (Stripe hosted Checkout, PR-C) is available for
   *  this business. The tender still only renders when the terminal is ONLINE. */
  stripeQrEnabled?: boolean;
}) {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  // Ethical tip selection: No-Tip (default, first-class), an anchored %, or a
  // custom amount. `customTipDollars` is the raw text of the custom entry.
  const [tip, setTip] = useState<TipSelection>(NO_TIP);
  const [customTipDollars, setCustomTipDollars] = useState("");
  const [discountDollars, setDiscountDollars] = useState("");
  const [tendering, setTendering] = useState(false);
  // CASH (numpad + change) vs MANUAL/"Other" (payment taken outside the app).
  const [tenderMethod, setTenderMethod] = useState<TenderMethod>("CASH");
  // Processor-backed "Card / QR" (Stripe hosted Checkout, PR-C) is a SEPARATE
  // rail from the cash/confirm-QR/manual tenders: it opens a Stripe session and
  // settles via webhook, NEVER through submit()/the offline queue. When selected
  // the CartPanel renders the StripeQrPanel instead of the normal tender body.
  const [stripeQrSelected, setStripeQrSelected] = useState(false);
  const [tenderDollars, setTenderDollars] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [queued, setQueued] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Manager-PIN override for an UNVERIFIED tender (QR/Other) rung by a cashier.
  // null = prompt closed. Opened when the server returns manager_approval_required.
  const [managerPinPrompt, setManagerPinPrompt] = useState<{ pin: string; error: string | null } | null>(
    null,
  );
  // The idempotency key for the in-flight checkout. Generated per attempt and
  // REUSED across a manager-PIN retry so a sale that committed on the first send
  // (then got re-sent with a PIN) is reconciled by clientUuid, not duplicated.
  const clientUuidRef = useRef<string | null>(null);
  // Re-entrancy guard: a fast double-tap of "Complete sale" must not fire two
  // checkouts (each would otherwise mint its own order). A ref (not `pending`
  // state) so the guard is effective within the same synchronous tick (Round-3 #2).
  const inFlightRef = useRef(false);
  // The active operator's membershipId, captured while online, stamped onto an
  // offline-queued sale so replay attributes it to who rang it (Round-3 #3).
  const cashierMembershipIdRef = useRef<string | null>(null);
  // Gates cart persistence until after the first hydrate, so the initial empty
  // cart never overwrites a stored work-in-progress order before we restore it.
  const cartHydratedRef = useRef(false);
  // Item awaiting modifier selection (null = picker closed).
  const [picking, setPicking] = useState<SellableEntry | null>(null);
  // Per-device, per-business favorites (variation ids) + grid/list density.
  const [favorites, setFavorites] = useState<string[]>([]);
  const [density, setDensity] = useState<Density>("grid");
  // Mobile cart Sheet (desktop renders the cart inline and ignores this).
  const [cartOpen, setCartOpen] = useState(false);
  const { online, pending: queuedCount, syncing, needsReconciliation, lastReplay, submit } =
    useOfflineCheckout();
  const { toast } = useToast();
  // Multi-sensory tap confirmation (haptic + optional click) for item taps and
  // the charge action, so cashiers trust a press without looking.
  const { tap, soundEnabled, toggleSound } = useTapFeedback();

  // Feedback keyed off the ACTUAL outcome of each replay pass — never off the
  // queue merely draining to zero (a sale can leave the queue by being parked in
  // the dead-letter store, which is NOT a success). Fires once per pass:
  //   • only-committed  → "Offline sales synced" (success)
  //   • any dead-lettered → a distinct warning; the persistent banner below then
  //     keeps the "needs reconciliation" count visible until it's resolved.
  const lastReplayAtRef = useRef(0);
  useEffect(() => {
    if (!lastReplay || lastReplay.at === lastReplayAtRef.current) return;
    lastReplayAtRef.current = lastReplay.at;
    if (lastReplay.deadLettered > 0) {
      const n = lastReplay.deadLettered;
      toast({
        title: `${n} offline ${n === 1 ? "sale" : "sales"} couldn't be synced`,
        description: "Cash was collected but the sale was refused. See “needs reconciliation” above.",
        variant: "error",
        duration: 8000,
      });
    } else if (lastReplay.committed > 0) {
      toast({ title: "Offline sales synced", variant: "success" });
    }
  }, [lastReplay, toast]);

  const money = (c: number) => formatMoney(c, currency);

  // Display label for a tender method (QR shows the merchant's configured rail).
  const tenderLabel = (method: TenderMethod) =>
    method === "CASH" ? "Cash" : method === "QR" ? qrPay?.label || "QR" : "Other";

  // Hydrate per-device prefs from localStorage after mount (avoids SSR mismatch).
  useEffect(() => {
    setFavorites(loadFavorites(businessId));
    setDensity(loadDensity());
    // Restore any in-progress cart left by a lock / refresh (Round-3 #1).
    const storedCart = loadStoredCart(businessId);
    if (storedCart && storedCart.length > 0) setCart(storedCart);
    cartHydratedRef.current = true;
    // Seed the ringing-operator id from the last online capture, then refresh it
    // from the server when online (best effort — offline keeps the cached value).
    cashierMembershipIdRef.current = loadStoredOperatorId(businessId);
    if (typeof navigator === "undefined" || navigator.onLine) {
      getActiveOperatorId({ businessId })
        .then(({ membershipId }) => {
          if (membershipId) {
            cashierMembershipIdRef.current = membershipId;
            saveStoredOperatorId(businessId, membershipId);
          }
        })
        .catch(() => {
          /* offline / transient — keep the cached id */
        });
    }
  }, [businessId]);

  // Mirror the in-progress cart to localStorage so a lock/refresh can restore it
  // (Round-3 #1). Gated on `cartHydratedRef` so the pre-hydrate empty cart never
  // clobbers a stored order; cleared to nothing when the cart empties.
  useEffect(() => {
    if (!cartHydratedRef.current) return;
    saveStoredCart(businessId, cart);
  }, [businessId, cart]);

  function onToggleFavorite(variationId: string) {
    setFavorites((cur) => {
      const next = toggleFavorite(cur, variationId);
      saveFavorites(businessId, next);
      return next;
    });
  }

  function onToggleDensity() {
    setDensity((cur) => {
      const next: Density = cur === "grid" ? "list" : "grid";
      saveDensity(next);
      return next;
    });
  }

  // "All" plus a "Favorites" pseudo-tab (only when some exist) plus the distinct
  // catalog categories, for the tab row.
  const categories = useMemo(() => {
    const set = new Set(catalog.map((e) => e.category));
    const base = ["All", ...[...set].sort((a, b) => a.localeCompare(b))];
    return favorites.length > 0 ? ["All", FAVORITES_PSEUDO_CATEGORY, ...base.slice(1)] : base;
  }, [catalog, favorites.length]);

  // If the active Favorites tab empties out (last star removed), fall back to All.
  useEffect(() => {
    if (activeCategory === FAVORITES_PSEUDO_CATEGORY && favorites.length === 0) {
      setActiveCategory("All");
    }
  }, [activeCategory, favorites.length]);

  const filtered = useMemo(
    () =>
      catalog.filter((e) => {
        const matchesCategory =
          activeCategory === "All"
            ? true
            : activeCategory === FAVORITES_PSEUDO_CATEGORY
              ? favorites.includes(e.variationId)
              : e.category === activeCategory;
        return (
          matchesCategory &&
          `${e.label} ${e.category}`.toLowerCase().includes(query.toLowerCase())
        );
      }),
    [catalog, query, activeCategory, favorites],
  );

  const cartDiscountCents = Math.max(0, Math.round(parseFloat(discountDollars || "0") * 100)) || 0;
  const cartCount = cart.reduce((n, l) => n + l.qty, 0);

  const totals = useMemo(() => {
    const lines: PricedLineInput[] = cart.map((l) => ({
      unitPriceCents: l.priceCents,
      quantity: l.qty,
      modifiers: l.modifiers.map((m) => ({
        id: m.id,
        nameSnapshot: m.name,
        priceDeltaCents: m.priceDeltaCents,
      })),
    }));
    const subtotal = lines.reduce(
      (s, l) =>
        s +
        (l.unitPriceCents + l.modifiers!.reduce((a, m) => a + m.priceDeltaCents, 0)) * l.quantity,
      0,
    );
    const tipCents = tipCentsFor(tip, Math.max(subtotal - cartDiscountCents, 0));
    return computePricedOrder(lines, { taxRateBps, cartDiscountCents, tipCents, taxInclusive });
  }, [cart, taxRateBps, cartDiscountCents, tip, taxInclusive]);

  // Base the tip percentages are computed against: the discounted subtotal.
  const tipBaseCents = Math.max(totals.subtotalCents - cartDiscountCents, 0);

  /** Add an item to the cart with an (already-chosen) modifier set. */
  function addLine(entry: SellableEntry, modifiers: ChosenModifier[]) {
    const key = lineKey(
      entry.variationId,
      modifiers.map((m) => m.id),
    );
    setCart((cur) => {
      const existing = cur.find((l) => l.key === key);
      if (existing) {
        return cur.map((l) => (l.key === key ? { ...l, qty: l.qty + 1 } : l));
      }
      return [
        ...cur,
        { key, variationId: entry.variationId, label: entry.label, priceCents: entry.priceCents, qty: 1, modifiers },
      ];
    });
  }

  function addToCart(entry: SellableEntry) {
    // Items with modifier groups open the picker; everything else adds directly.
    if (entry.modifierGroups.length > 0) {
      setPicking(entry);
      return;
    }
    addLine(entry, []);
  }

  function changeQty(key: string, delta: number) {
    setCart((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0),
    );
  }

  /** Add a cashier-typed ad-hoc modifier (e.g. "No onion", "Extra cheese +$0.75")
   * to a cart line. The `custom:` id prefix marks it so checkout sends it as a
   * customModifier (name + price), not a catalog modifier id. */
  function addCustomModifier(key: string, name: string, priceDeltaCents: number) {
    setCart((cur) =>
      cur.map((l) => {
        if (l.key !== key) return l;
        const modifiers = [
          ...l.modifiers,
          { id: `custom:${crypto.randomUUID()}`, name, priceDeltaCents },
        ];
        return { ...l, modifiers, key: lineKey(l.variationId, modifiers.map((m) => m.id)) };
      }),
    );
  }

  /** Remove a modifier (used for the cashier's ad-hoc ones) from a cart line. */
  function removeModifier(key: string, modId: string) {
    setCart((cur) =>
      cur.map((l) => {
        if (l.key !== key) return l;
        const modifiers = l.modifiers.filter((m) => m.id !== modId);
        return { ...l, modifiers, key: lineKey(l.variationId, modifiers.map((m) => m.id)) };
      }),
    );
  }

  function resetSale() {
    setCart([]);
    // Drop the persisted work-in-progress immediately (finishAndLock refreshes the
    // route right after, which can unmount before the cart-mirror effect runs).
    saveStoredCart(businessId, []);
    setTip(NO_TIP);
    setCustomTipDollars("");
    setDiscountDollars("");
    setTenderDollars("");
    setTenderMethod("CASH");
    setStripeQrSelected(false);
    setManualNote("");
    setTendering(false);
    setReceipt(null);
    setQueued(false);
    setError(null);
    setCartOpen(false);
    setManagerPinPrompt(null);
    clientUuidRef.current = null;
  }

  // After a completed sale, re-lock the terminal so the next order requires a PIN
  // (the chosen "re-lock after each sale" behavior). The shell re-renders to the
  // operator lock screen on refresh.
  async function finishAndLock() {
    // Single-operator "stay unlocked" mode: keep the current operator active so a
    // solo owner isn't re-authenticating before every sale. Otherwise re-lock the
    // terminal after each sale (secure shared-till default).
    if (!singleOperatorMode) {
      try {
        await lockOperator({ businessId });
      } catch {
        /* best effort — idle auto-lock is the backstop */
      }
    }
    resetSale();
    router.refresh();
  }

  // Run the checkout server action. `managerPin` is threaded through ONLY for the
  // manager-approval retry of an unverified tender; it's verified server-side.
  async function runCheckout(managerPin?: string) {
    const nonCash = tenderMethod !== "CASH";
    const cashTenderedCents = nonCash ? 0 : Math.round(parseFloat(tenderDollars || "0") * 100);
    if (!clientUuidRef.current) clientUuidRef.current = crypto.randomUUID();
    return submit({
      businessId,
      clientUuid: clientUuidRef.current,
      // Attribute an OFFLINE-replayed sale to the operator who RANG it, captured
      // while online (Round-3 #3). Ignored by online checkout (server-side).
      offlineCashierId: cashierMembershipIdRef.current ?? undefined,
      lines: cart.map((l) => {
        const custom = l.modifiers.filter((m) => m.id.startsWith("custom:"));
        return {
          variationId: l.variationId,
          quantity: l.qty,
          // Catalog modifiers go by id (server re-looks-up their price)…
          modifierIds: l.modifiers.filter((m) => !m.id.startsWith("custom:")).map((m) => m.id),
          // …ad-hoc ones carry their cashier-typed name + upcharge.
          customModifiers: custom.length
            ? custom.map((m) => ({ name: m.name, priceDeltaCents: m.priceDeltaCents }))
            : undefined,
        };
      }),
      tipCents: totals.tipCents,
      cartDiscountCents,
      method: tenderMethod,
      cashTenderedCents,
      manualNote: nonCash ? manualNote.trim() || undefined : undefined,
      managerPin,
      // OFFLINE PRICE SNAPSHOT: capture the prices QUOTED on screen at sale time,
      // index-aligned with `lines`. The server only honors this for a replayed
      // OFFLINE sale (cash already collected) — online checkout ignores it and
      // stays server-authoritative. See register/actions.ts.
      priceSnapshot: {
        quoted: true,
        lines: cart.map((l) => ({
          unitPriceCents: l.priceCents,
          // Only CATALOG modifier deltas are snapshotted (keyed by real id). The
          // cashier's ad-hoc modifiers are already trusted via customModifiers.
          modifierDeltas: Object.fromEntries(
            l.modifiers
              .filter((m) => !m.id.startsWith("custom:"))
              .map((m) => [m.id, m.priceDeltaCents]),
          ),
        })),
      },
    });
  }

  async function completeSale() {
    // Re-entrancy guard (Round-3 #2): a fast double-tap must not fire two
    // checkouts. Checked via a ref so it holds within the same synchronous tick,
    // before React commits `pending`.
    if (inFlightRef.current) return;
    setError(null);
    const nonCash = tenderMethod !== "CASH";
    const cashTenderedCents = nonCash ? 0 : Math.round(parseFloat(tenderDollars || "0") * 100);
    if (!nonCash && cashTenderedCents < totals.totalCents) {
      setError("Cash tendered is less than the total.");
      return;
    }
    // ONE idempotency key per sale: generated lazily (in runCheckout) and REUSED
    // across retries until the sale resolves, so a double-send is reconciled by
    // clientUuid rather than minting a second order. resetSale() clears it.
    inFlightRef.current = true;
    setPending(true);
    try {
      const result = await runCheckout();
      if (result.status === "completed") {
        setReceipt(result.receipt);
      } else if (result.status === "queued") {
        setQueued(true);
      } else {
        // Unverified tender needs a manager's PIN — open the prompt.
        setManagerPinPrompt({
          pin: "",
          error: result.rejection.error === "invalid_manager_pin" ? "Incorrect manager PIN." : null,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed.");
    } finally {
      setPending(false);
      inFlightRef.current = false;
    }
  }

  // Submit the manager-PIN override and retry the SAME sale (same clientUuid).
  async function submitManagerPin() {
    if (!managerPinPrompt) return;
    const pin = managerPinPrompt.pin;
    setPending(true);
    try {
      const result = await runCheckout(pin);
      if (result.status === "completed") {
        setManagerPinPrompt(null);
        setReceipt(result.receipt);
      } else if (result.status === "queued") {
        setManagerPinPrompt(null);
        setQueued(true);
      } else {
        // Still rejected — wrong/locked PIN. Keep the prompt open with an error.
        setManagerPinPrompt({ pin: "", error: "Incorrect manager PIN. Ask a manager to approve." });
      }
    } catch (err) {
      setManagerPinPrompt({
        pin: "",
        error: err instanceof Error ? err.message : "Approval failed.",
      });
    } finally {
      setPending(false);
    }
  }

  if (queued) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardContent className="p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15 text-warning">
            <CloudOff size={30} />
          </div>
          <h2 className="text-xl font-bold">Sale saved offline</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            No connection right now. This sale is stored on this device and will be sent
            automatically when you&apos;re back online.
          </p>
          <div className="mt-6 space-y-2 border-t border-border pt-4 text-left text-sm">
            <Row label="Total" value={money(totals.totalCents)} />
            {tenderMethod === "CASH" ? (
              <Row label="Cash" value={money(Math.round(parseFloat(tenderDollars || "0") * 100))} />
            ) : (
              <Row
                label="Payment"
                value={`${tenderLabel(tenderMethod)}${manualNote.trim() ? ` · ${manualNote.trim()}` : ""}`}
              />
            )}
          </div>
          <Button onClick={finishAndLock} size="lg" className="mt-6 w-full">
            New sale
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (receipt) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <CardContent className="p-8">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/15 text-success">
            <Check size={30} />
          </div>
          <h2 className="text-xl font-bold">Sale complete</h2>
          <p className="mt-1 text-sm text-muted-foreground">Order #{receipt.number}</p>
          {receipt.method === "CASH" ? (
            <>
              <p className="numeric mt-6 text-5xl font-black text-success">{money(receipt.changeCents)}</p>
              <p className="text-sm font-medium text-muted-foreground">change due</p>
              <div className="mt-6 space-y-2 border-t border-border pt-4 text-left text-sm">
                <Row label="Total" value={money(receipt.totalCents)} />
                <Row label="Cash" value={money(receipt.cashTenderedCents)} />
                <Row label="Tax" value={money(receipt.taxCents)} />
                {receipt.tipCents > 0 && <Row label="Tip" value={money(receipt.tipCents)} />}
              </div>
            </>
          ) : (
            <>
              <p className="numeric mt-6 text-5xl font-black text-success">{money(receipt.totalCents)}</p>
              <p className="text-sm font-medium text-muted-foreground">
                paid · {tenderLabel(receipt.method)}
                {receipt.manualNote ? ` · ${receipt.manualNote}` : ""}
              </p>
              <div className="mt-6 space-y-2 border-t border-border pt-4 text-left text-sm">
                <Row label="Total" value={money(receipt.totalCents)} />
                <Row label="Tax" value={money(receipt.taxCents)} />
                {receipt.tipCents > 0 && <Row label="Tip" value={money(receipt.tipCents)} />}
              </div>
            </>
          )}
          <Button onClick={finishAndLock} size="lg" className="mt-6 w-full">
            New sale
          </Button>
        </CardContent>
      </Card>
    );
  }

  const cartPanel = (
    <CartPanel
      cart={cart}
      money={money}
      totals={totals}
      taxInclusive={taxInclusive}
      discountDollars={discountDollars}
      setDiscountDollars={setDiscountDollars}
      tip={tip}
      setTip={setTip}
      customTipDollars={customTipDollars}
      setCustomTipDollars={setCustomTipDollars}
      tipBaseCents={tipBaseCents}
      tendering={tendering}
      setTendering={setTendering}
      tenderMethod={tenderMethod}
      setTenderMethod={setTenderMethod}
      tenderLabel={tenderLabel}
      qrPay={qrPay}
      stripeQrEnabled={stripeQrEnabled}
      online={online}
      stripeQrSelected={stripeQrSelected}
      setStripeQrSelected={setStripeQrSelected}
      businessId={businessId}
      cartDiscountCents={cartDiscountCents}
      onNewSale={finishAndLock}
      tenderDollars={tenderDollars}
      setTenderDollars={setTenderDollars}
      manualNote={manualNote}
      setManualNote={setManualNote}
      error={error}
      pending={pending}
      changeQty={changeQty}
      addCustomModifier={addCustomModifier}
      removeModifier={removeModifier}
      completeSale={completeSale}
      tap={tap}
    />
  );

  return (
    <div className="space-y-4">
      {picking && (
        <ModifierPicker
          entry={picking}
          currency={currency}
          onCancel={() => setPicking(null)}
          onConfirm={(modifiers) => {
            addLine(picking, modifiers);
            setPicking(null);
          }}
        />
      )}
      {managerPinPrompt && (
        <ManagerApprovalPrompt
          methodLabel={tenderLabel(tenderMethod)}
          amount={money(totals.totalCents)}
          pin={managerPinPrompt.pin}
          error={managerPinPrompt.error}
          pending={pending}
          onChangePin={(pin) => setManagerPinPrompt((cur) => (cur ? { ...cur, pin } : cur))}
          onCancel={() => setManagerPinPrompt(null)}
          onSubmit={submitManagerPin}
        />
      )}
      <OfflineBanner online={online} queuedCount={queuedCount} syncing={syncing} />
      <ReconciliationBanner count={needsReconciliation} />
      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      {/* Catalog */}
      <Card>
        <CardContent className="p-4 md:p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search items"
                aria-label="Search items"
                className="pl-10"
              />
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={onToggleDensity}
              aria-label={density === "grid" ? "Switch to list view" : "Switch to grid view"}
              title={density === "grid" ? "List view" : "Grid view"}
            >
              {density === "grid" ? <List size={18} /> : <LayoutGrid size={18} />}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={toggleSound}
              aria-pressed={soundEnabled}
              aria-label={soundEnabled ? "Turn tap sound off" : "Turn tap sound on"}
              title={soundEnabled ? "Tap sound on" : "Tap sound off"}
            >
              {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </Button>
          </div>
          {categories.length > 2 && (
            <div className="-mx-1 mb-4 flex gap-2 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filter by category">
              {categories.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={activeCategory === c}
                  onClick={() => setActiveCategory(c)}
                  className={cn(
                    "h-9 shrink-0 rounded-full px-4 text-sm font-semibold transition-colors",
                    activeCategory === c
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground hover:bg-secondary",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
          {filtered.length === 0 ? (
            <EmptyState
              favoritesEmpty={activeCategory === FAVORITES_PSEUDO_CATEGORY}
              catalogEmpty={catalog.length === 0}
              businessId={businessId}
            />
          ) : density === "list" ? (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {filtered.map((entry) => (
                <li key={entry.variationId} className="flex items-center gap-2 p-3">
                  <FavoriteStar
                    active={isFavorite(favorites, entry.variationId)}
                    label={entry.label}
                    onToggle={() => onToggleFavorite(entry.variationId)}
                  />
                  <button
                    onClick={() => {
                      tap();
                      addToCart(entry);
                    }}
                    className="flex flex-1 items-center justify-between gap-3 rounded-md px-2 py-1 text-left transition-colors hover:bg-muted active:scale-[0.99]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-semibold">{entry.label}</span>
                      <span className="text-xs text-muted-foreground">{entry.category}</span>
                      <StockBadge
                        trackStock={entry.trackStock}
                        stock={entry.stock}
                        className="mt-1"
                      />
                    </span>
                    <span className="numeric shrink-0 font-black">{money(entry.priceCents)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((entry) => (
                <div
                  key={entry.variationId}
                  className="group relative rounded-lg border border-border bg-card p-4 transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md"
                >
                  <FavoriteStar
                    active={isFavorite(favorites, entry.variationId)}
                    label={entry.label}
                    onToggle={() => onToggleFavorite(entry.variationId)}
                    className="absolute right-2 top-2"
                  />
                  <button
                    onClick={() => {
                      tap();
                      addToCart(entry);
                    }}
                    className="block w-full text-left active:scale-[0.98]"
                  >
                    <div className="mb-6 flex items-center justify-between">
                      <Badge variant={entry.type === "SERVICE" ? "primary" : "muted"}>{entry.category}</Badge>
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground group-hover:bg-primary group-hover:text-primary-foreground">
                        <Plus size={16} />
                      </span>
                    </div>
                    <h3 className="font-semibold leading-tight">{entry.label}</h3>
                    <p className="numeric mt-1 text-2xl font-black">{money(entry.priceCents)}</p>
                    <StockBadge
                      trackStock={entry.trackStock}
                      stock={entry.stock}
                      className="mt-2"
                    />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cart — inline on desktop (xl+), in a slide-up Sheet on mobile. */}
      <Card className="hidden h-fit xl:sticky xl:top-6 xl:block">
        <CardContent className="p-4 md:p-5">{cartPanel}</CardContent>
      </Card>

      <Sheet open={cartOpen} onOpenChange={setCartOpen}>
        <SheetContent side="bottom" className="xl:hidden">
          <SheetHeader>
            <SheetTitle>Current sale</SheetTitle>
          </SheetHeader>
          <div className="mt-2">{cartPanel}</div>
        </SheetContent>
      </Sheet>
      </div>

      {/* Mobile cart bar — opens the Sheet; hidden on desktop where the cart is inline. */}
      <button
        type="button"
        onClick={() => setCartOpen(true)}
        // Sit ABOVE the fixed BottomNav on phones (its ~64px height + safe-area
        // inset); the nav is hidden at lg+, so drop back to a plain bottom gap there.
        className="fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 flex items-center justify-between gap-3 rounded-xl bg-primary px-5 py-3 text-primary-foreground shadow-lg active:scale-[0.99] lg:bottom-3 xl:hidden"
        aria-label={`Open cart, ${cartCount} ${cartCount === 1 ? "item" : "items"}, total ${money(totals.totalCents)}`}
      >
        <span className="flex items-center gap-2 font-bold">
          <span className="relative">
            <ShoppingCart size={20} />
            {cartCount > 0 && (
              <span className="numeric absolute -right-2 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-card px-1 text-[10px] font-black text-foreground">
                {cartCount}
              </span>
            )}
          </span>
          View cart
        </span>
        <span className="numeric font-black">{money(totals.totalCents)}</span>
      </button>
    </div>
  );
}

/**
 * Low/out-of-stock indicator for a catalog card. Renders nothing when the item
 * doesn't track stock (or has healthy stock), a warning "Low stock" chip in the
 * (0, threshold] band, and a destructive "Out of stock" chip at/below zero. The
 * badge is informational only — the register never blocks adding an out-of-stock
 * item (a POS must not freeze a sale over inventory). The text is descriptive so
 * it reads correctly to assistive tech without extra aria.
 */
function StockBadge({
  trackStock,
  stock,
  className,
}: {
  trackStock?: boolean;
  stock?: number | null;
  className?: string;
}) {
  if (!trackStock) return null;
  const status = stockStatus(stock);
  if (status === "out") {
    return (
      <Badge variant="destructive" className={cn("block w-fit", className)}>
        Out of stock
      </Badge>
    );
  }
  if (status === "low") {
    return (
      <Badge variant="warning" className={cn("block w-fit", className)}>
        Low stock · {stock} left
      </Badge>
    );
  }
  return null;
}

/** Star toggle for favoriting a catalog entry. Stops click propagation so it
 *  never also adds the item to the cart. */
function FavoriteStar({
  active,
  label,
  onToggle,
  className,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={active}
      aria-label={active ? `Remove ${label} from favorites` : `Add ${label} to favorites`}
      title={active ? "Remove favorite" : "Add favorite"}
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-warning" : "text-muted-foreground",
        className,
      )}
    >
      <Star size={18} fill={active ? "currentColor" : "none"} />
    </button>
  );
}

/** The current-sale panel (cart lines + totals + tender). Rendered inline on
 *  desktop and inside the mobile Sheet — identical behavior in both. */
/**
 * Per-line ad-hoc modifier adder. The cashier types a modification on the order
 * screen, picks No (free) or Extra, and optionally an upcharge on the Extra — no
 * back-office setup. Emits the composed name ("No onion" / "Extra cheese") + cents.
 */
function LineModAdder({ onAdd }: { onAdd: (name: string, priceDeltaCents: number) => void }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"No" | "Extra">("Extra");
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");

  function submit() {
    const n = name.trim();
    if (!n) return;
    const cents =
      mode === "Extra" ? Math.max(0, Math.round((parseFloat(price || "0") || 0) * 100)) : 0;
    onAdd(`${mode} ${n}`, cents);
    setName("");
    setPrice("");
    setMode("Extra");
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-xs font-medium text-primary hover:underline"
      >
        + Modify
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-muted/40 p-2">
      <div className="flex gap-1">
        {(["No", "Extra"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "flex-1 rounded-md px-2 py-1 text-xs font-semibold transition-colors",
              mode === m ? "bg-primary text-primary-foreground" : "bg-background hover:bg-secondary",
            )}
          >
            {m}
          </button>
        ))}
      </div>
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="e.g. onion"
        aria-label="Modification"
        className="h-9 text-sm"
        autoFocus
      />
      {mode === "Extra" && (
        <Input
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Upcharge (optional, e.g. 0.75)"
          aria-label="Extra upcharge"
          className="numeric h-9 text-sm"
        />
      )}
      <div className="flex gap-2">
        <Button size="sm" onClick={submit} disabled={!name.trim()} className="flex-1">
          Add
        </Button>
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Ethical tip screen. Anchored 15/20/25% options, each showing the computed
 * dollar amount, PLUS a Custom amount entry PLUS a first-class "No tip" button
 * rendered with identical prominence — never hidden or de-emphasized. All money
 * stays integer cents (custom entry parses through `dollarsToCents`).
 */
function TipSelector({
  tip,
  setTip,
  customTipDollars,
  setCustomTipDollars,
  tipBaseCents,
  money,
}: {
  tip: TipSelection;
  setTip: (v: TipSelection) => void;
  customTipDollars: string;
  setCustomTipDollars: (v: string) => void;
  tipBaseCents: number;
  money: (c: number) => string;
}) {
  const customActive = tip.kind === "custom";
  const options = [
    {
      key: "none",
      label: "No tip",
      sub: money(0),
      selected: tip.kind === "none",
      onSelect: () => setTip(NO_TIP),
    },
    ...TIP_PERCENTS.map((rate) => ({
      key: String(rate),
      label: `${Math.round(rate * 100)}%`,
      sub: money(tipCentsFor({ kind: "percent", rate }, tipBaseCents)),
      selected: tip.kind === "percent" && tip.rate === rate,
      onSelect: () => setTip({ kind: "percent", rate }),
    })),
  ];

  return (
    <div>
      <p className="mb-1.5 text-muted-foreground">Tip</p>
      <div className="grid grid-cols-4 gap-2">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={o.onSelect}
            aria-pressed={o.selected}
            className={cn(
              "flex h-14 flex-col items-center justify-center rounded-md text-sm font-semibold transition-colors active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              o.selected
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-foreground hover:bg-secondary",
            )}
          >
            <span>{o.label}</span>
            <span className="numeric text-xs font-normal opacity-80">{o.sub}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTip({ kind: "custom", cents: dollarsToCents(customTipDollars) })}
        aria-pressed={customActive}
        className={cn(
          "mt-2 flex h-12 w-full items-center justify-center rounded-md text-sm font-semibold transition-colors active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          customActive
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground hover:bg-secondary",
        )}
      >
        Custom amount
      </button>
      {customActive && (
        <label className="mt-2 flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Custom tip ($)</span>
          <Input
            inputMode="decimal"
            value={customTipDollars}
            onChange={(e) => {
              setCustomTipDollars(e.target.value);
              setTip({ kind: "custom", cents: dollarsToCents(e.target.value) });
            }}
            placeholder="0.00"
            aria-label="Custom tip amount"
            className="numeric h-11 w-28 text-right"
            autoFocus
          />
        </label>
      )}
    </div>
  );
}

function CartPanel({
  cart,
  money,
  totals,
  taxInclusive,
  discountDollars,
  setDiscountDollars,
  tip,
  setTip,
  customTipDollars,
  setCustomTipDollars,
  tipBaseCents,
  tendering,
  setTendering,
  tenderMethod,
  setTenderMethod,
  tenderLabel,
  qrPay,
  stripeQrEnabled,
  online,
  stripeQrSelected,
  setStripeQrSelected,
  businessId,
  cartDiscountCents,
  onNewSale,
  tenderDollars,
  setTenderDollars,
  manualNote,
  setManualNote,
  error,
  pending,
  changeQty,
  addCustomModifier,
  removeModifier,
  completeSale,
  tap,
}: {
  cart: CartLine[];
  money: (c: number) => string;
  totals: { subtotalCents: number; taxCents: number; tipCents: number; totalCents: number };
  taxInclusive: boolean;
  discountDollars: string;
  setDiscountDollars: (v: string) => void;
  tip: TipSelection;
  setTip: (v: TipSelection) => void;
  customTipDollars: string;
  setCustomTipDollars: (v: string) => void;
  tipBaseCents: number;
  tendering: boolean;
  setTendering: (v: boolean) => void;
  tenderMethod: TenderMethod;
  setTenderMethod: (v: TenderMethod) => void;
  tenderLabel: (m: TenderMethod) => string;
  qrPay: QrPayConfig | null;
  stripeQrEnabled: boolean;
  online: boolean;
  stripeQrSelected: boolean;
  setStripeQrSelected: (v: boolean) => void;
  businessId: string;
  cartDiscountCents: number;
  onNewSale: () => void;
  tenderDollars: string;
  setTenderDollars: (v: string) => void;
  manualNote: string;
  setManualNote: (v: string) => void;
  error: string | null;
  pending: boolean;
  changeQty: (key: string, delta: number) => void;
  addCustomModifier: (key: string, name: string, priceDeltaCents: number) => void;
  removeModifier: (key: string, modId: string) => void;
  completeSale: () => void;
  tap: () => void;
}) {
  // Available tender rails. "Card / QR" (processor-backed Stripe Checkout) shows
  // ONLY when enabled for the business AND the terminal is online (cards are
  // never queued offline — invariant #5).
  const showStripeQr = stripeQrEnabled && online;
  const tenderSlots: (TenderMethod | "STRIPE_QR")[] = [
    "CASH",
    ...(qrPay ? (["QR"] as const) : []),
    ...(showStripeQr ? (["STRIPE_QR"] as const) : []),
    "MANUAL",
  ];
  return (
    <>
      <h2 className="mb-4 hidden text-lg font-bold xl:block">Current sale</h2>
      <div className="min-h-32 space-y-2">
        {cart.length === 0 && (
          <p className="rounded-lg bg-muted p-4 text-sm text-muted-foreground">
            Cart is empty. Tap an item to start.
          </p>
        )}
        {cart.map((line) => {
          const lineUnit =
            line.priceCents + line.modifiers.reduce((a, m) => a + m.priceDeltaCents, 0);
          return (
            <div key={line.key} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="min-w-0">
                <p className="truncate font-semibold">{line.label}</p>
                {line.modifiers.length > 0 && (
                  <ul className="mt-0.5 space-y-0.5">
                    {line.modifiers.map((m) => (
                      <li key={m.id} className="numeric flex items-center gap-1 text-xs text-muted-foreground">
                        <span className="truncate">
                          + {m.name}
                          {m.priceDeltaCents !== 0 && <> ({money(m.priceDeltaCents)})</>}
                        </span>
                        {m.id.startsWith("custom:") && (
                          <button
                            type="button"
                            onClick={() => removeModifier(line.key, m.id)}
                            aria-label={`Remove ${m.name}`}
                            className="shrink-0 rounded px-1 text-muted-foreground hover:text-destructive"
                          >
                            ×
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="numeric text-sm text-muted-foreground">{money(lineUnit)} each</p>
                <LineModAdder onAdd={(name, cents) => addCustomModifier(line.key, name, cents)} />
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  variant="secondary"
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  onClick={() => changeQty(line.key, -1)}
                  aria-label={`Remove one ${line.label}`}
                >
                  −
                </Button>
                <span className="numeric w-6 text-center font-bold">{line.qty}</span>
                <Button
                  size="icon"
                  className="h-10 w-10 rounded-full"
                  onClick={() => changeQty(line.key, 1)}
                  aria-label={`Add one ${line.label}`}
                >
                  +
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 space-y-3 border-t border-border pt-4 text-sm">
        <Row label="Subtotal" value={money(totals.subtotalCents)} />
        <label className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground">Discount ($)</span>
          <Input
            inputMode="decimal"
            value={discountDollars}
            onChange={(e) => setDiscountDollars(e.target.value)}
            placeholder="0.00"
            className="numeric h-10 w-24 text-right"
          />
        </label>
        <Row label={taxInclusive ? "Tax (included)" : "Tax"} value={money(totals.taxCents)} />
        <TipSelector
          tip={tip}
          setTip={setTip}
          customTipDollars={customTipDollars}
          setCustomTipDollars={setCustomTipDollars}
          tipBaseCents={tipBaseCents}
          money={money}
        />
        <Row label="Tip total" value={money(totals.tipCents)} />
        <div className="flex items-center justify-between pt-3 text-2xl font-black">
          <span>Total</span>
          <span className="numeric">{money(totals.totalCents)}</span>
        </div>

        {error && (
          <p className="text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        {!tendering ? (
          <Button
            variant="success"
            size="lg"
            disabled={cart.length === 0}
            onClick={() => {
              tap();
              setTendering(true);
              // Start empty so the numpad/quick-cash chips fill it cleanly.
              setTenderDollars("");
            }}
            className="mt-2 w-full"
          >
            Charge {money(totals.totalCents)}
          </Button>
        ) : (
          <div className="mt-2 space-y-3 rounded-lg bg-muted p-4">
            {/* Tender method: Cash (numpad + change), confirm-QR (scan to pay)
                when the merchant configured it, processor-backed Card / QR (Stripe
                Checkout, online only), and Other (any out-of-band payment). */}
            <div
              className="grid gap-2"
              style={{ gridTemplateColumns: `repeat(${tenderSlots.length}, minmax(0, 1fr))` }}
              role="tablist"
              aria-label="Payment method"
            >
              {tenderSlots.map((m) => {
                const selected =
                  m === "STRIPE_QR" ? stripeQrSelected : !stripeQrSelected && tenderMethod === m;
                const label = m === "STRIPE_QR" ? "Card / QR" : tenderLabel(m);
                return (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => {
                      if (m === "STRIPE_QR") {
                        setStripeQrSelected(true);
                      } else {
                        setStripeQrSelected(false);
                        setTenderMethod(m);
                      }
                    }}
                    className={cn(
                      "h-11 rounded-md text-sm font-semibold transition-colors",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-foreground hover:bg-secondary",
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {stripeQrSelected ? (
              <StripeQrPanel
                businessId={businessId}
                cart={cart}
                tipCents={totals.tipCents}
                cartDiscountCents={cartDiscountCents}
                totalCents={totals.totalCents}
                money={money}
                onNewSale={onNewSale}
                onBack={() => setStripeQrSelected(false)}
              />
            ) : tenderMethod === "CASH" ? (
              <>
                <div>
                  <span className="mb-1 block font-medium">Cash received</span>
                  <div
                    className="numeric flex h-14 items-center justify-end rounded-md border border-border bg-card px-4 text-3xl font-black"
                    aria-live="polite"
                  >
                    {money(dollarsToCents(tenderDollars))}
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {quickTenderOptions(totals.totalCents).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setTenderDollars((c / 100).toFixed(2))}
                      className="h-11 rounded-md border border-border bg-card text-sm font-bold transition-colors hover:bg-secondary active:scale-[0.98]"
                    >
                      {c === totals.totalCents ? "Exact" : money(c)}
                    </button>
                  ))}
                </div>
                <NumberPad value={tenderDollars} onChange={setTenderDollars} />
                <div className="flex items-center justify-between border-t border-border pt-3 text-lg font-bold">
                  <span>Change due</span>
                  <span className="numeric">
                    {money(Math.max(0, dollarsToCents(tenderDollars) - totals.totalCents))}
                  </span>
                </div>
              </>
            ) : tenderMethod === "QR" && qrPay ? (
              <>
                <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-4">
                  <div className="rounded-lg bg-white p-3">
                    <QRCodeSVG value={qrPay.value} size={176} />
                  </div>
                  <p className="text-center text-sm text-muted-foreground">
                    {qrPay.label ? `Scan to pay with ${qrPay.label}` : "Scan to pay"}
                  </p>
                  <p className="numeric text-2xl font-black">{money(totals.totalCents)}</p>
                </div>
                <label className="block">
                  <span className="mb-1 block font-medium">Reference (optional)</span>
                  <Input
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="Confirmation #, sender…"
                    maxLength={120}
                    aria-label="Payment reference"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Have the customer scan and pay, then confirm to record the sale.
                </p>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-4 py-3 text-lg font-bold">
                  <span>Amount</span>
                  <span className="numeric">{money(totals.totalCents)}</span>
                </div>
                <label className="block">
                  <span className="mb-1 block font-medium">Reference (optional)</span>
                  <Input
                    value={manualNote}
                    onChange={(e) => setManualNote(e.target.value)}
                    placeholder="Card, check, transfer…"
                    maxLength={120}
                    aria-label="Payment reference"
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  Records a payment taken outside the app (external card reader, check, bank
                  transfer). No card data is stored.
                </p>
              </>
            )}

            {/* Card / QR (Stripe) drives its own actions inside StripeQrPanel;
                the cash/confirm-QR/manual rails use the shared complete button. */}
            {!stripeQrSelected && (
              <>
                <Button
                  variant="success"
                  size="lg"
                  onClick={() => {
                    tap();
                    completeSale();
                  }}
                  disabled={
                    pending ||
                    (tenderMethod === "CASH" && dollarsToCents(tenderDollars) < totals.totalCents)
                  }
                  className="w-full"
                >
                  {pending
                    ? "Saving…"
                    : tenderMethod !== "CASH"
                      ? `Record ${money(totals.totalCents)}`
                      : "Complete sale"}
                </Button>
                <Button variant="outline" onClick={() => setTendering(false)} className="w-full">
                  Back
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/** Map cart lines to the QR-sale action payload (catalog modifiers by id; ad-hoc
 *  ones carry their cashier-typed name + upcharge). The server re-looks-up every
 *  price — nothing here is trusted. Mirrors the cash checkout's line mapping. */
function cartToQrLines(cart: CartLine[]) {
  return cart.map((l) => {
    const custom = l.modifiers.filter((m) => m.id.startsWith("custom:"));
    return {
      variationId: l.variationId,
      quantity: l.qty,
      modifierIds: l.modifiers.filter((m) => !m.id.startsWith("custom:")).map((m) => m.id),
      customModifiers: custom.length
        ? custom.map((m) => ({ name: m.name, priceDeltaCents: m.priceDeltaCents }))
        : undefined,
    };
  });
}

/**
 * Processor-backed "Card / QR" tender (PAYMENTS.md §9, PR-C). On mount it opens a
 * Stripe hosted Checkout Session on the merchant's connected account
 * (`createStripeQrSale`, which recomputes the total SERVER-SIDE — the cart is sent
 * for pricing, never a price), renders the returned Checkout URL as a QR + a
 * tappable link, and POLLS `getStripeQrSaleState` until the WEBHOOK settles it.
 *
 * This rail NEVER goes through submit()/the offline queue — a card sale is only
 * ever attempted online, and it's the webhook (not the client) that marks it paid.
 */
function StripeQrPanel({
  businessId,
  cart,
  tipCents,
  cartDiscountCents,
  totalCents,
  money,
  onNewSale,
  onBack,
}: {
  businessId: string;
  cart: CartLine[];
  tipCents: number;
  cartDiscountCents: number;
  totalCents: number;
  money: (c: number) => string;
  onNewSale: () => void;
  onBack: () => void;
}) {
  type Phase = "creating" | "awaiting" | "paid" | "failed" | "error";
  const [phase, setPhase] = useState<Phase>("creating");
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // One idempotency key per attempt. Reset on retry so an EXPIRED/FAILED attempt
  // mints a fresh session (a Stripe session can't be reused once it's expired).
  const clientUuidRef = useRef<string | null>(null);
  const startedRef = useRef(false);

  async function start() {
    clientUuidRef.current = crypto.randomUUID();
    setPhase("creating");
    setMessage(null);
    setQrUrl(null);
    setSessionId(null);
    try {
      const res = await createStripeQrSale({
        businessId,
        clientUuid: clientUuidRef.current,
        lines: cartToQrLines(cart),
        tipCents,
        cartDiscountCents,
      });
      if (!res.ok) {
        setPhase("error");
        setMessage("Card payments aren’t available right now.");
        return;
      }
      setQrUrl(res.qrUrl);
      setSessionId(res.stripeSessionId);
      setPhase("awaiting");
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Couldn’t start the card payment.");
    }
  }

  // Open the session once when this panel first mounts.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void start();
    // start() closes over the cart at mount time — a one-shot on select.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll the webhook-settled session state while awaiting payment.
  useEffect(() => {
    if (phase !== "awaiting" || !sessionId) return;
    let active = true;
    const interval = setInterval(async () => {
      try {
        const state = await getStripeQrSaleState({ businessId, stripeSessionId: sessionId });
        if (!active || !state) return;
        if (state.status === "CAPTURED") setPhase("paid");
        else if (state.status === "EXPIRED" || state.status === "FAILED") setPhase("failed");
      } catch {
        /* transient network — keep polling */
      }
    }, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [phase, sessionId, businessId]);

  if (phase === "paid") {
    return (
      <div className="flex flex-col items-center gap-3 rounded-md border border-success/40 bg-success/10 p-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/20 text-success">
          <Check size={26} />
        </div>
        <p className="font-bold text-success">Card payment received</p>
        <p className="numeric text-2xl font-black">{money(totalCents)}</p>
        <Button size="lg" className="w-full" onClick={onNewSale}>
          New sale
        </Button>
      </div>
    );
  }

  if (phase === "failed" || phase === "error") {
    return (
      <div className="space-y-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-center">
        <p className="font-semibold text-destructive">
          {phase === "failed" ? "Payment didn’t complete" : message}
        </p>
        {phase === "failed" && (
          <p className="text-sm text-muted-foreground">
            The session expired or the payment failed. Start a new card payment or choose another tender.
          </p>
        )}
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => void start()}>
            Try again
          </Button>
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-card p-4">
      {phase === "creating" || !qrUrl ? (
        <p className="py-8 text-sm text-muted-foreground">Starting card payment…</p>
      ) : (
        <>
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={qrUrl} size={176} />
          </div>
          <p className="text-center text-sm text-muted-foreground">Scan to pay by card / wallet</p>
          <p className="numeric text-2xl font-black">{money(totalCents)}</p>
          <Link
            href={qrUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-primary hover:underline"
          >
            Open payment page
          </Link>
          <p className="text-xs text-muted-foreground">Waiting for the customer to pay…</p>
          <Button variant="outline" className="w-full" onClick={onBack}>
            Cancel
          </Button>
        </>
      )}
    </div>
  );
}

function OfflineBanner({
  online,
  queuedCount,
  syncing,
}: {
  online: boolean;
  queuedCount: number;
  syncing: boolean;
}) {
  if (online && queuedCount === 0) return null;

  if (!online) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning-foreground"
      >
        <WifiOff size={16} className="shrink-0 text-warning" />
        <span>
          Offline — sales are saved on this device
          {queuedCount > 0 ? ` (${queuedCount} waiting to sync)` : ""} and sent when you reconnect.
        </span>
      </div>
    );
  }

  // Online but draining the backlog.
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2.5 text-sm font-medium text-foreground"
    >
      <RefreshCw size={16} className={cn("shrink-0 text-primary", syncing && "animate-spin")} />
      <span>
        {syncing ? "Syncing" : "Pending"} {queuedCount} offline{" "}
        {queuedCount === 1 ? "sale" : "sales"}…
      </span>
    </div>
  );
}

/**
 * Modal that prompts the cashier to choose modifiers for an item, honoring each
 * group's minSelect/maxSelect. The "Add" button is disabled until every group's
 * minimum is satisfied; the server re-validates the same rules at checkout.
 */
function ModifierPicker({
  entry,
  currency,
  onCancel,
  onConfirm,
}: {
  entry: SellableEntry;
  currency: string;
  onCancel: () => void;
  onConfirm: (modifiers: ChosenModifier[]) => void;
}) {
  const money = (c: number) => formatMoney(c, currency);
  // Selected modifier ids per group.
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  function toggle(group: SellableModifierGroup, modifierId: string) {
    setSelected((cur) => {
      const chosen = cur[group.id] ?? [];
      const has = chosen.includes(modifierId);
      let next: string[];
      if (has) {
        next = chosen.filter((id) => id !== modifierId);
      } else if (group.maxSelect <= 1) {
        // Single-select: replace.
        next = [modifierId];
      } else if (chosen.length >= group.maxSelect) {
        return cur; // at the cap — ignore
      } else {
        next = [...chosen, modifierId];
      }
      return { ...cur, [group.id]: next };
    });
  }

  const satisfied = entry.modifierGroups.every(
    (g) => (selected[g.id]?.length ?? 0) >= g.minSelect,
  );

  function confirm() {
    const modifiers: ChosenModifier[] = [];
    for (const g of entry.modifierGroups) {
      for (const id of selected[g.id] ?? []) {
        const m = g.modifiers.find((x) => x.id === id);
        if (m) modifiers.push({ id: m.id, name: m.name, priceDeltaCents: m.priceDeltaCents });
      }
    }
    onConfirm(modifiers);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        // Closing via Escape / overlay / X counts as cancel.
        if (!isOpen) onCancel();
      }}
    >
      <DialogContent
        aria-label={`Choose options for ${entry.label}`}
        className="max-h-[85vh] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{entry.label}</DialogTitle>
          <p className="numeric text-sm text-muted-foreground">{money(entry.priceCents)}</p>
        </DialogHeader>

        <div className="space-y-5">
          {entry.modifierGroups.map((group) => {
            const chosen = selected[group.id] ?? [];
            const rule =
              group.minSelect > 0
                ? `Choose ${group.minSelect}${group.maxSelect > group.minSelect ? `–${group.maxSelect}` : ""}`
                : group.maxSelect > 1
                  ? `Optional · up to ${group.maxSelect}`
                  : "Optional";
            return (
              <div key={group.id}>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">{group.name}</h3>
                  <span className="text-xs text-muted-foreground">{rule}</span>
                </div>
                <div className="space-y-1.5">
                  {group.modifiers.map((m) => {
                    const active = chosen.includes(m.id);
                    return (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => toggle(group, m.id)}
                        aria-pressed={active}
                        className={cn(
                          "flex w-full items-center justify-between rounded-md border p-3 text-left text-sm transition-colors",
                          active
                            ? "border-primary bg-primary/10 font-semibold"
                            : "border-border hover:bg-muted",
                        )}
                      >
                        <span>{m.name}</span>
                        <span className="numeric text-muted-foreground">
                          {m.priceDeltaCents > 0 ? `+${money(m.priceDeltaCents)}` : money(m.priceDeltaCents)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter className="mt-6">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!satisfied} className="flex-1">
            Add to cart
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const PIN_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"] as const;

/**
 * Manager-PIN prompt shown when a cashier (an operator WITHOUT
 * `approve_unverified_tender`) rings an UNVERIFIED tender (QR / Other). The PIN
 * is verified SERVER-SIDE against a capability-holding member; this is only the
 * entry surface. Attribution stays the cashier — the manager merely authorizes.
 * An operator who already holds the capability never sees this (the server
 * approves silently).
 */
function ManagerApprovalPrompt({
  methodLabel,
  amount,
  pin,
  error,
  pending,
  onChangePin,
  onCancel,
  onSubmit,
}: {
  methodLabel: string;
  amount: string;
  pin: string;
  error: string | null;
  pending: boolean;
  onChangePin: (pin: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  function press(key: string) {
    if (key === "back") onChangePin(pin.slice(0, -1));
    else if (/^\d$/.test(key) && pin.length < PIN_MAX_LENGTH) onChangePin(pin + key);
  }

  return (
    <Dialog
      open
      onOpenChange={(isOpen) => {
        if (!isOpen && !pending) onCancel();
      }}
    >
      <DialogContent aria-label="Manager approval required" className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Lock size={22} />
          </div>
          <DialogTitle className="text-center">Manager approval</DialogTitle>
          <p className="text-center text-sm text-muted-foreground">
            {methodLabel} is an unverified tender. A manager must enter their PIN to approve{" "}
            <span className="numeric font-semibold">{amount}</span>.
          </p>
        </DialogHeader>

        <div
          className={cn(
            "mb-3 flex h-14 items-center justify-center rounded-lg border bg-card text-2xl font-black tracking-[0.3em]",
            error ? "border-destructive/60" : "border-border",
          )}
          aria-live="polite"
        >
          {pin.replace(/./g, "•") || (
            <span className="text-base font-normal text-muted-foreground">····</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PIN_KEYS.map((key, i) =>
            key === "" ? (
              <div key={i} />
            ) : (
              <button
                key={i}
                type="button"
                onClick={() => press(key)}
                disabled={pending}
                aria-label={key === "back" ? "Delete" : key}
                className="flex h-14 items-center justify-center rounded-md border border-border bg-card text-xl font-bold transition-colors hover:bg-muted active:scale-[0.98] disabled:opacity-50"
              >
                {key === "back" ? <Delete size={20} /> : key}
              </button>
            ),
          )}
        </div>

        {error && (
          <p className="mt-3 text-center text-sm font-medium text-destructive" role="alert">
            {error}
          </p>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={onCancel} disabled={pending} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={onSubmit}
            disabled={pending || pin.length < PIN_MIN_LENGTH}
            className="flex-1"
          >
            {pending ? "Checking…" : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EmptyState({
  favoritesEmpty,
  catalogEmpty,
  businessId,
}: {
  favoritesEmpty?: boolean;
  catalogEmpty?: boolean;
  businessId: string;
}) {
  if (favoritesEmpty) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg bg-muted p-10 text-center">
        <Star size={28} className="text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          No favorites yet. Tap the star on an item to pin it here.
        </p>
      </div>
    );
  }

  // No products in the catalog at all — give the merchant a real way forward
  // instead of a dead-end instruction, a prominent button to the Products screen.
  if (catalogEmpty) {
    return (
      <div className="flex flex-col items-center gap-4 rounded-lg bg-muted p-10 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <PackagePlus size={28} />
        </div>
        <div className="space-y-1">
          <h3 className="text-base font-bold">No items to sell yet</h3>
          <p className="text-sm text-muted-foreground">
            Add your first product to start ringing up sales.
          </p>
        </div>
        <Link
          href={`/${businessId}/products`}
          className={cn(buttonVariants({ size: "lg" }), "mt-1")}
        >
          <PackagePlus size={20} />
          Add your first item
        </Link>
      </div>
    );
  }

  // Catalog has products, but the current search / category filter matched none.
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg bg-muted p-10 text-center">
      <Search size={28} className="text-muted-foreground" />
      <p className="text-sm text-muted-foreground">
        No items match your search. Try a different term or category.
      </p>
    </div>
  );
}

/**
 * Persistent, high-visibility indicator that one or more cash-collected offline
 * sales could not be replayed and are parked in the dead-letter store awaiting
 * manual reconciliation (HIGH #2). Unlike a toast, it stays on screen until the
 * count returns to zero, so the discrepancy can never be silently missed.
 */
function ReconciliationBanner({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-foreground"
    >
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-destructive" />
      <span>
        {count} {count === 1 ? "sale needs" : "sales need"} reconciliation — cash was collected
        but {count === 1 ? "it" : "they"} couldn&apos;t be synced to the server. Contact a manager
        to record {count === 1 ? "it" : "them"} manually.
      </span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="numeric font-bold">{value}</span>
    </div>
  );
}
