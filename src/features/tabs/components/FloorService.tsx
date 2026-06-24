"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { FLOOR_WIDTH, FLOOR_HEIGHT } from "@/features/floor/schema";
import { openTab } from "@/features/tabs/actions";
import type { FloorServiceRoom } from "@/features/tabs/queries";

function shapeRadius(shape: "ROUND" | "SQUARE" | "RECT"): string {
  return shape === "ROUND" ? "9999px" : "0.5rem";
}

/** "5m" / "1h 20m" since an ISO timestamp; client-only to avoid SSR clock skew. */
function useElapsed(): (iso: string) => string | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (iso: string) => {
    if (now === null) return null;
    const mins = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
    if (mins < 60) return `${mins}m`;
    return `${Math.floor(mins / 60)}h ${mins % 60}m`;
  };
}

export function FloorService({
  businessId,
  currency,
  rooms,
}: {
  businessId: string;
  currency: string;
  rooms: FloorServiceRoom[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [activeRoomId, setActiveRoomId] = useState<string | null>(rooms[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const elapsed = useElapsed();

  // Keep the floor live across devices: re-fetch the server data every 15s while
  // the tab is visible, so one server sees another's open/closed tabs without a
  // manual reload. Pauses when the page is hidden to avoid pointless churn.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = setInterval(tick, 15_000);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? rooms[0] ?? null;
  const pct = (n: number, total: number) => `${(n / total) * 100}%`;

  function goToTab(orderId: string) {
    router.push(`/${businessId}/floor/${orderId}`);
  }

  function onTableClick(table: FloorServiceRoom["tables"][number]) {
    if (pending) return;
    setError(null);
    if (table.tab) {
      goToTab(table.tab.orderId);
      return;
    }
    startTransition(async () => {
      try {
        const orderId = await openTab({ businessId, tableId: table.id });
        goToTab(orderId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not open the tab.");
      }
    });
  }

  if (rooms.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-muted-foreground">
        No rooms yet. Set up your dining room in{" "}
        <a className="font-medium text-primary underline" href={`/${businessId}/settings`}>
          Settings → Floor plan
        </a>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Room tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {rooms.map((room) => {
          const open = room.tables.filter((t) => t.tab).length;
          return (
            <button
              key={room.id}
              type="button"
              onClick={() => setActiveRoomId(room.id)}
              className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
                room.id === activeRoom?.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70"
              }`}
            >
              {room.name}
              <span className="ml-2 rounded-full bg-black/10 px-1.5 text-xs">
                {open}/{room.tables.length}
              </span>
            </button>
          );
        })}
      </div>

      {error && (
        <p className="text-sm font-medium text-destructive" role="status">
          {error}
        </p>
      )}

      {activeRoom && (
        <div
          className="relative w-full overflow-hidden rounded-xl border border-border bg-muted/40"
          style={{ aspectRatio: `${FLOOR_WIDTH} / ${FLOOR_HEIGHT}` }}
        >
          {activeRoom.tables.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
              No tables in this room yet.
            </p>
          )}
          {activeRoom.tables.map((t) => {
            const occupied = !!t.tab;
            return (
              <button
                key={t.id}
                type="button"
                disabled={pending}
                onClick={() => onTableClick(t)}
                aria-label={
                  occupied
                    ? `Table ${t.label}, occupied, ${formatMoney(t.tab!.totalCents, currency)}`
                    : `Table ${t.label}, available`
                }
                className={`absolute flex flex-col items-center justify-center border-2 p-1 text-center text-xs font-semibold shadow-sm transition-colors disabled:opacity-60 ${
                  occupied
                    ? "border-primary bg-primary/20 text-foreground hover:bg-primary/30"
                    : "border-border bg-card text-muted-foreground hover:border-primary/50 hover:text-foreground"
                }`}
                style={{
                  left: pct(t.x, FLOOR_WIDTH),
                  top: pct(t.y, FLOOR_HEIGHT),
                  width: pct(t.width, FLOOR_WIDTH),
                  height: pct(t.height, FLOOR_HEIGHT),
                  borderRadius: shapeRadius(t.shape),
                }}
              >
                <span className="leading-tight">{t.label}</span>
                {occupied ? (
                  <span className="mt-0.5 block text-[10px] font-bold text-primary">
                    {formatMoney(t.tab!.totalCents, currency)}
                  </span>
                ) : (
                  <span className="mt-0.5 flex items-center gap-0.5 text-[10px] font-normal">
                    <Users size={10} /> {t.seats}
                  </span>
                )}
                {occupied && (
                  <span className="mt-0.5 block text-[9px] font-normal text-muted-foreground">
                    #{t.tab!.number}
                    {t.tab!.guests > 0 ? ` · ${t.tab!.guests}p` : ""}
                    {elapsed(t.tab!.openedAt) ? ` · ${elapsed(t.tab!.openedAt)}` : ""}
                    {t.tab!.merged ? " · merged" : ""}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        <span className="mr-3">
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-border bg-card align-middle" />
          Available
        </span>
        <span>
          <span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm border border-primary bg-primary/20 align-middle" />
          Open tab
        </span>
      </p>
    </div>
  );
}
