"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { QRCodeSVG } from "qrcode.react";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from "lucide-react";
import { formatMoney } from "@/lib/money";
import { computePricedOrder, type PricedLineInput } from "@/features/register/pricing";
import { isOutOfStock } from "@/features/catalog/stock";
import type { SellableEntry } from "@/features/catalog/queries";
import { submitOnlineOrder } from "@/features/online/actions";
import { isOnlineConfirmation, type OnlineOrderConfirmation } from "@/features/online/schema";
import type { PublicMenu } from "@/features/online/queries";
import { parsePayHandle } from "@/features/online/pay-link";

interface CartLine {
  key: string;
  entry: SellableEntry;
  modifierIds: string[];
  quantity: number;
}

function lineKey(variationId: string, modifierIds: string[]): string {
  return `${variationId}::${[...modifierIds].sort().join(",")}`;
}

/** All modifiers across an entry's groups, flattened for delta/name lookup. */
function flatModifiers(entry: SellableEntry) {
  return entry.modifierGroups.flatMap((g) => g.modifiers);
}

export function PublicOrder({ menu }: { menu: PublicMenu }) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [picking, setPicking] = useState<SellableEntry | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [confirmation, setConfirmation] = useState<OnlineOrderConfirmation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Idempotency key for the CURRENT cart attempt. Generated ONCE and reused across
  // retries so a lost-response retry hits the server's idempotency guard instead of
  // minting a duplicate order. Rotated only after a success (fresh cart) — see below.
  const clientUuidRef = useRef<string>("");
  if (!clientUuidRef.current) clientUuidRef.current = crypto.randomUUID();

  const priced = useMemo(() => {
    const inputs: PricedLineInput[] = cart.map((line) => {
      const mods = flatModifiers(line.entry).filter((m) => line.modifierIds.includes(m.id));
      return {
        unitPriceCents: line.entry.priceCents,
        quantity: line.quantity,
        modifiers: mods.map((m) => ({
          id: m.id,
          nameSnapshot: m.name,
          priceDeltaCents: m.priceDeltaCents,
        })),
      };
    });
    return computePricedOrder(inputs, {
      taxRateBps: menu.taxRateBps,
      taxInclusive: menu.taxInclusive,
    });
  }, [cart, menu.taxRateBps, menu.taxInclusive]);

  const itemCount = cart.reduce((n, l) => n + l.quantity, 0);

  // Reassure the customer they aren't being charged now (v1 is pay-on-pickup / the
  // merchant's static pay handle — no card is captured on this screen).
  const chargeNote = menu.qrPay
    ? `You won't be charged now — pay with ${menu.qrPay.label?.trim() || "the store's pay link"} or when you pick up.`
    : "You won't be charged now — pay when you pick up.";

  // Group entries by category, preserving first-seen order.
  const categories = useMemo(() => {
    const map = new Map<string, SellableEntry[]>();
    for (const e of menu.entries) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return [...map.entries()];
  }, [menu.entries]);

  function addToCart(entry: SellableEntry, modifierIds: string[]) {
    const key = lineKey(entry.variationId, modifierIds);
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) => (l.key === key ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { key, entry, modifierIds, quantity: 1 }];
    });
  }

  function onAdd(entry: SellableEntry) {
    if (entry.modifierGroups.some((g) => g.modifiers.length > 0)) {
      setPicking(entry);
    } else {
      addToCart(entry, []);
    }
  }

  function setQuantity(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0),
    );
  }

  function removeLine(key: string) {
    setCart((prev) => prev.filter((l) => l.key !== key));
  }

  function placeOrder() {
    if (cart.length === 0 || pending) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await submitOnlineOrder({
          businessId: menu.businessId,
          // Stable across retries (see clientUuidRef) so a resent request is deduped.
          clientUuid: clientUuidRef.current,
          lines: cart.map((l) => ({
            variationId: l.entry.variationId,
            quantity: l.quantity,
            modifierIds: l.modifierIds.length ? l.modifierIds : undefined,
          })),
          customerName: customerName.trim() || undefined,
          customerPhone: customerPhone.trim() || undefined,
          tipCents: 0,
        });
        if (isOnlineConfirmation(result)) {
          setConfirmation(result);
          setCart([]);
          setReviewOpen(false);
          // Success: rotate the key so the NEXT cart is a distinct order.
          clientUuidRef.current = crypto.randomUUID();
          return;
        }
        setError(
          result.error === "rate_limited"
            ? "You're ordering a bit fast — please wait a moment and try again."
            : result.error === "unavailable"
              ? "Online ordering isn't available right now."
              : "One or more items are no longer available. Please review your order, remove anything sold out, and try again.",
        );
      } catch {
        // Thrown error (network drop, server 500, etc.) — the cart is preserved, so
        // the customer can simply retry; the stable clientUuid keeps it idempotent.
        setError(
          "We couldn't reach the store just now. Your order wasn't placed — please check your connection and try again.",
        );
      }
    });
  }

  if (confirmation) {
    return (
      <Confirmation
        menu={menu}
        confirmation={confirmation}
        onReset={() => {
          setConfirmation(null);
          setCustomerName("");
          setCustomerPhone("");
        }}
      />
    );
  }

  return (
    <div className="mx-auto min-h-screen max-w-2xl bg-background px-4 pb-40 pt-6 text-foreground">
      <header className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">Order ahead</p>
        <h1 className="text-2xl font-black tracking-tight">{menu.name}</h1>
      </header>

      {categories.length === 0 && (
        <p className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-muted-foreground">
          The menu is empty right now. Please check back soon.
        </p>
      )}

      <div className="space-y-8">
        {categories.map(([category, entries]) => (
          <section key={category}>
            <h2 className="mb-3 text-sm font-black uppercase tracking-wide text-muted-foreground">
              {category}
            </h2>
            <ul className="space-y-2">
              {entries.map((entry) => {
                const out = entry.trackStock ? isOutOfStock(entry.stock) : false;
                return (
                  <li key={entry.variationId}>
                    <button
                      type="button"
                      disabled={out}
                      onClick={() => onAdd(entry)}
                      className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/50 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="min-w-0">
                        <span className="block font-semibold leading-tight">{entry.label}</span>
                        {out && (
                          <span className="mt-0.5 block text-xs font-medium text-destructive">
                            Sold out
                          </span>
                        )}
                        {!out && entry.modifierGroups.some((g) => g.modifiers.length > 0) && (
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            Options available
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="numeric font-semibold">
                          {formatMoney(entry.priceCents, menu.currency)}
                        </span>
                        {!out && (
                          <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
                            <Plus size={16} />
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      {/* Cart / customer / place order */}
      {cart.length > 0 && (
        <section className="mt-10" aria-label="Your order">
          <h2 className="mb-3 text-lg font-black">Your order</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {cart.map((line) => {
              const mods = flatModifiers(line.entry).filter((m) =>
                line.modifierIds.includes(m.id),
              );
              const unit =
                line.entry.priceCents + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
              return (
                <li key={line.key} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{line.entry.label}</p>
                    {mods.length > 0 && (
                      <p className="truncate text-xs text-muted-foreground">
                        {mods.map((m) => m.name).join(", ")}
                      </p>
                    )}
                    <p className="numeric text-sm text-muted-foreground">
                      {formatMoney(unit * line.quantity, menu.currency)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => setQuantity(line.key, -1)}
                      className="grid size-11 place-items-center rounded-full border border-border active:scale-95"
                    >
                      <Minus size={16} />
                    </button>
                    <span className="numeric w-6 text-center font-semibold">{line.quantity}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => setQuantity(line.key, 1)}
                      className="grid size-11 place-items-center rounded-full border border-border active:scale-95"
                    >
                      <Plus size={16} />
                    </button>
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => removeLine(line.key)}
                      className="ml-1 grid size-11 place-items-center rounded-full text-muted-foreground hover:text-destructive active:scale-95"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-4 grid gap-3">
            <label className="text-sm font-medium">
              Your name (optional)
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                maxLength={80}
                autoComplete="name"
                className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3"
              />
            </label>
            <label className="text-sm font-medium">
              Phone (optional)
              <input
                type="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                maxLength={40}
                autoComplete="tel"
                className="mt-1 h-11 w-full rounded-lg border border-border bg-background px-3"
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </section>
      )}

      {/* Sticky totals / place-order bar */}
      {cart.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-card/95 backdrop-blur">
          <div className="mx-auto max-w-2xl px-4 py-3">
            {/* Tap-to-expand review of the line items (they're a scroll away above). */}
            {reviewOpen && (
              <div className="mb-3 max-h-56 overflow-y-auto rounded-xl border border-border bg-background p-3">
                <ul className="divide-y divide-border">
                  {cart.map((line) => {
                    const mods = flatModifiers(line.entry).filter((m) =>
                      line.modifierIds.includes(m.id),
                    );
                    const unit =
                      line.entry.priceCents + mods.reduce((s, m) => s + m.priceDeltaCents, 0);
                    return (
                      <li key={line.key} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0 truncate text-sm">
                          <span className="numeric font-semibold">{line.quantity}×</span>{" "}
                          {line.entry.label}
                        </span>
                        <span className="numeric shrink-0 text-sm text-muted-foreground">
                          {formatMoney(unit * line.quantity, menu.currency)}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            <p className="mb-2 text-center text-xs text-muted-foreground">{chargeNote}</p>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={() => setReviewOpen((v) => !v)}
                aria-expanded={reviewOpen}
                className="flex min-w-0 items-center gap-1.5 rounded-lg py-1 text-left active:scale-[0.98]"
              >
                <span className="min-w-0">
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {itemCount} item{itemCount === 1 ? "" : "s"} ·{" "}
                    {menu.taxInclusive
                      ? "tax incl."
                      : `+ ${formatMoney(priced.taxCents, menu.currency)} tax`}
                    {reviewOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                  </span>
                  <span className="numeric block text-lg font-black">
                    {formatMoney(priced.totalCents, menu.currency)}
                  </span>
                </span>
                <span className="sr-only">
                  {reviewOpen ? "Hide order details" : "Review order details"}
                </span>
              </button>
              <button
                type="button"
                onClick={placeOrder}
                disabled={pending}
                className="ml-auto inline-flex h-12 items-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground shadow-sm active:scale-[0.98] disabled:opacity-60"
              >
                <ShoppingBag size={18} />
                {pending ? "Placing…" : "Place order"}
              </button>
            </div>
          </div>
        </div>
      )}

      {picking && (
        <ModifierPicker
          entry={picking}
          currency={menu.currency}
          onClose={() => setPicking(null)}
          onConfirm={(modifierIds) => {
            addToCart(picking, modifierIds);
            setPicking(null);
          }}
        />
      )}
    </div>
  );
}

/** Lightweight modifier picker honoring each group's min/maxSelect. */
function ModifierPicker({
  entry,
  currency,
  onClose,
  onConfirm,
}: {
  entry: SellableEntry;
  currency: string;
  onClose: () => void;
  onConfirm: (modifierIds: string[]) => void;
}) {
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  function toggle(groupId: string, modifierId: string, maxSelect: number) {
    setSelected((prev) => {
      const cur = prev[groupId] ?? [];
      if (cur.includes(modifierId)) {
        return { ...prev, [groupId]: cur.filter((id) => id !== modifierId) };
      }
      // Single-select (max 1) replaces; multi-select appends up to the cap.
      if (maxSelect <= 1) return { ...prev, [groupId]: [modifierId] };
      if (cur.length >= maxSelect) return prev;
      return { ...prev, [groupId]: [...cur, modifierId] };
    });
  }

  const groups = entry.modifierGroups.filter((g) => g.modifiers.length > 0);
  const unmet = groups.filter((g) => (selected[g.id] ?? []).length < g.minSelect);
  const chosen = groups.flatMap((g) => selected[g.id] ?? []);
  // Running item price = base + selected modifier deltas (reflects choices live).
  const runningCents =
    entry.priceCents +
    groups
      .flatMap((g) => g.modifiers)
      .filter((m) => chosen.includes(m.id))
      .reduce((s, m) => s + m.priceDeltaCents, 0);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 sm:items-center">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-card p-5 shadow-lg sm:rounded-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-lg font-black">{entry.label}</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5">
          {groups.map((group) => (
            <fieldset key={group.id}>
              <legend className="mb-2 text-sm font-semibold">
                {group.name}
                <span className="ml-2 font-normal text-muted-foreground">
                  {group.minSelect > 0 ? "Required · " : ""}
                  {group.maxSelect > 1 ? `choose up to ${group.maxSelect}` : "choose one"}
                </span>
              </legend>
              <div className="space-y-1">
                {group.modifiers.map((m) => {
                  const isSel = (selected[group.id] ?? []).includes(m.id);
                  return (
                    <label
                      key={m.id}
                      className={`flex cursor-pointer items-center justify-between gap-3 rounded-lg border p-3 ${
                        isSel ? "border-primary bg-primary/10" : "border-border"
                      }`}
                    >
                      <span className="flex items-center gap-3">
                        <input
                          type={group.maxSelect > 1 ? "checkbox" : "radio"}
                          name={group.id}
                          checked={isSel}
                          onChange={() => toggle(group.id, m.id, group.maxSelect)}
                          className="size-4"
                        />
                        <span className="font-medium">{m.name}</span>
                      </span>
                      {m.priceDeltaCents !== 0 && (
                        <span className="numeric text-sm text-muted-foreground">
                          +{formatMoney(m.priceDeltaCents, currency)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ))}
        </div>

        <button
          type="button"
          disabled={unmet.length > 0}
          onClick={() => onConfirm(chosen)}
          className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary font-semibold text-primary-foreground active:scale-[0.98] disabled:opacity-60"
        >
          {unmet.length > 0 ? (
            `Choose ${unmet[0]!.name}`
          ) : (
            <>
              <span>Add to order</span>
              <span className="numeric opacity-90">
                · {formatMoney(runningCents, currency)}
              </span>
            </>
          )}
        </button>
      </div>
    </div>
  );
}

/** Post-submit confirmation: order number, total, pickup instructions, tappable pay. */
function Confirmation({
  menu,
  confirmation,
  onReset,
}: {
  menu: PublicMenu;
  confirmation: OnlineOrderConfirmation;
  onReset: () => void;
}) {
  const [done, setDone] = useState(false);
  const total = formatMoney(confirmation.totalCents, menu.currency);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center px-4 py-12 text-center text-foreground">
      <CheckCircle2 className="text-success" size={56} />
      <h1 className="mt-4 text-2xl font-black">Order placed!</h1>
      <p className="mt-1 text-muted-foreground">{menu.name} has your order.</p>

      <div className="mt-6 w-full rounded-2xl border border-border bg-card p-6 shadow-sm">
        <p className="text-sm text-muted-foreground">Your order number</p>
        <p className="numeric text-5xl font-black">#{confirmation.number}</p>
        <p className="numeric mt-2 text-lg font-semibold">{total}</p>
      </div>

      {menu.instructions && (
        <div className="mt-4 w-full rounded-xl border border-border bg-muted/30 p-4 text-left text-sm">
          <p className="mb-1 font-semibold">Pickup</p>
          <p className="whitespace-pre-wrap text-muted-foreground">{menu.instructions}</p>
        </div>
      )}

      <PaySection menu={menu} total={total} />

      {done ? (
        <p className="mt-8 text-sm text-muted-foreground">
          Show order <span className="numeric font-semibold text-foreground">#{confirmation.number}</span>{" "}
          at pickup. You can close this page.
        </p>
      ) : (
        <div className="mt-8 flex w-full flex-col gap-2">
          <button
            type="button"
            onClick={() => setDone(true)}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground shadow-sm active:scale-[0.98]"
          >
            Done
          </button>
          <button
            type="button"
            onClick={onReset}
            className="inline-flex h-11 items-center justify-center rounded-xl border border-border px-6 font-medium text-muted-foreground active:scale-[0.98]"
          >
            Place another order
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The pay moment. The customer is holding the ONLY phone, so we lead with a
 * TAPPABLE pay action derived from the merchant's handle (see parsePayHandle) and
 * demote the QR to an "or scan from another device" secondary affordance.
 */
function PaySection({ menu, total }: { menu: PublicMenu; total: string }) {
  const [copied, setCopied] = useState(false);

  if (!menu.qrPay) {
    return (
      <div className="mt-4 w-full rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">
          Pay when you pick up. Just show your order number.
        </p>
      </div>
    );
  }

  const label = menu.qrPay.label?.trim() || "your payment app";
  const action = parsePayHandle(menu.qrPay.value);

  async function copyHandle() {
    try {
      await navigator.clipboard.writeText(action.display);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (permissions / insecure context) — the handle is shown
      // in full above, so the customer can still copy it manually.
      setCopied(false);
    }
  }

  return (
    <div className="mt-4 w-full rounded-2xl border border-border bg-card p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-semibold">Pay {menu.name}</p>
        <p className="numeric text-lg font-black">{total}</p>
      </div>

      {action.kind === "link" ? (
        <a
          href={action.href}
          {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 font-semibold text-primary-foreground shadow-sm active:scale-[0.98]"
        >
          Pay with {menu.qrPay.label?.trim() || "your app"}
          {action.external && <ExternalLink size={16} />}
        </a>
      ) : (
        <div className="mt-3">
          <p className="mb-2 text-left text-sm text-muted-foreground">
            Open {label} and pay {menu.name} using this handle:
          </p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted/40 px-3 py-2 text-left text-sm font-semibold">
              {action.display}
            </code>
            <button
              type="button"
              onClick={copyHandle}
              aria-label="Copy pay handle"
              className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground active:scale-[0.98]"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* Secondary: the QR still works when a SECOND device can scan it. */}
      <details className="mt-4 text-left">
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Or scan from another device
        </summary>
        <div className="mt-3 flex flex-col items-center">
          <div className="rounded-lg bg-white p-3">
            <QRCodeSVG value={menu.qrPay.value} size={140} />
          </div>
        </div>
      </details>

      <p className="mt-3 text-xs text-muted-foreground">
        After paying, show your order number at pickup.
      </p>
    </div>
  );
}
