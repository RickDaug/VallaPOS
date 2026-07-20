"use client";

import { useEffect, useState } from "react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DrawerSessionRow } from "@/features/cash-drawer/queries";

const USD = "USD";
const toCents = (s: string) => Math.round((parseFloat(s) || 0) * 100);

/**
 * Offline-edition Cash Drawer (docs/EDITIONS.md §5b) — open/close a session
 * through the local store (`getOpenSession` / `openDrawer` / `closeDrawer`).
 * Client-fetch, single-operator (no role gate). Blind-count close reveals the
 * variance.
 */
export default function LocalDrawerPage() {
  // undefined = still loading; null = no open session.
  const [session, setSession] = useState<DrawerSessionRow | null | undefined>(undefined);
  const [floatStr, setFloatStr] = useState("");
  const [countStr, setCountStr] = useState("");
  const [busy, setBusy] = useState(false);
  const [closedVariance, setClosedVariance] = useState<number | null>(null);

  const refresh = () =>
    getLocalStore().store.getOpenSession(LOCAL_BUSINESS_ID).then(setSession);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      getLocalStore()
        .store.getOpenSession(LOCAL_BUSINESS_ID)
        .then((s) => {
          if (active) setSession(s);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  async function open() {
    setBusy(true);
    setClosedVariance(null);
    await getLocalStore().store.openDrawer({
      businessId: LOCAL_BUSINESS_ID,
      openingFloatCents: toCents(floatStr),
    });
    setFloatStr("");
    await refresh();
    setBusy(false);
  }

  async function close() {
    if (!session) return;
    setBusy(true);
    const res = await getLocalStore().store.closeDrawer({
      businessId: LOCAL_BUSINESS_ID,
      sessionId: session.id,
      countedCents: toCents(countStr),
    });
    setClosedVariance(res.varianceCents);
    setCountStr("");
    await refresh();
    setBusy(false);
  }

  if (session === undefined) return <p className="text-sm text-muted-foreground">Loading drawer&hellip;</p>;

  return (
    <section className="max-w-md">
      <h1 className="mb-6 text-2xl font-black md:text-3xl">Cash drawer</h1>
      <Card>
        <CardContent className="flex flex-col gap-4 p-5">
          {session ? (
            <>
              <p className="text-sm text-muted-foreground">
                Open since {new Date(session.openedAt).toLocaleString()}
              </p>
              <p>
                Opening float:{" "}
                <span className="numeric font-semibold">
                  {formatMoney(session.openingFloatCents, USD)}
                </span>
              </p>
              <label className="text-sm font-medium">
                Counted cash
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={countStr}
                  onChange={(e) => setCountStr(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-right numeric"
                />
              </label>
              <Button onClick={close} disabled={busy} className="w-full">
                {busy ? "Closing…" : "Close drawer"}
              </Button>
            </>
          ) : (
            <>
              {closedVariance !== null ? (
                <p className="rounded-lg bg-muted p-3 text-center text-sm">
                  Drawer closed. Variance:{" "}
                  <span className="numeric font-semibold">{formatMoney(closedVariance, USD)}</span>
                </p>
              ) : null}
              <label className="text-sm font-medium">
                Opening float
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={floatStr}
                  onChange={(e) => setFloatStr(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-right numeric"
                />
              </label>
              <Button onClick={open} disabled={busy} className="w-full">
                {busy ? "Opening…" : "Open drawer"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
