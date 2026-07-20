"use client";

import { useEffect, useState } from "react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { formatMoney } from "@/lib/money";
import { Card, CardContent } from "@/components/ui/card";
import type { DailyReport } from "@/features/orders/queries";

const USD = "USD";

/** Local calendar-day window [midnight, next midnight). */
function todayRange(): { start: Date; end: Date } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * Offline-edition Reports (docs/EDITIONS.md §5b) — today's summary read straight
 * from the local store's `getDailyReport`. Client-fetch, no server auth / date
 * picker / CSV (v1 = today; range + exports are follow-ups).
 */
export default function LocalReportsPage() {
  const [report, setReport] = useState<DailyReport | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      const { start, end } = todayRange();
      getLocalStore()
        .store.getDailyReport(LOCAL_BUSINESS_ID, start, end)
        .then((r) => {
          if (active) setReport(r);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  if (!report) return <p className="text-sm text-muted-foreground">Loading report&hellip;</p>;

  const stats: ReadonlyArray<readonly [string, string]> = [
    ["Orders", String(report.orderCount)],
    ["Net sales", formatMoney(report.netSalesCents, USD)],
    ["Tax collected", formatMoney(report.taxCents, USD)],
    ["Total collected", formatMoney(report.totalCollectedCents, USD)],
    ["Cash collected", formatMoney(report.cashCollectedCents, USD)],
  ];

  return (
    <section>
      <header className="mb-6">
        <h1 className="text-2xl font-black md:text-3xl">Today</h1>
        <p className="text-sm text-muted-foreground">Sales summary for today.</p>
      </header>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map(([label, value]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
              <p className="numeric mt-1 text-xl font-black">{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
