"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useConfirm } from "@/components/ui/confirm-dialog";
import {
  createRoom,
  renameRoom,
  deleteRoom,
  createTable,
  updateTable,
  deleteTable,
  quickAddTables,
} from "@/features/floor/actions";
import {
  FLOOR_WIDTH,
  FLOOR_HEIGHT,
  MIN_TABLE_SIZE,
  MAX_TABLE_SIZE,
  MAX_TABLES_PER_BUSINESS,
  SHAPES,
  clamp,
} from "@/features/floor/schema";
import type { FloorRoomLayout, FloorTableLayout } from "@/features/floor/queries";

type Shape = (typeof SHAPES)[number];

/** Tailwind border-radius per shape (RECT and SQUARE differ only in size, set by w/h). */
function shapeRadius(shape: Shape): string {
  return shape === "ROUND" ? "9999px" : "0.5rem";
}

export function FloorPlanEditor({
  businessId,
  initialRooms,
}: {
  businessId: string;
  initialRooms: FloorRoomLayout[];
}) {
  const router = useRouter();
  const [confirm, confirmEl] = useConfirm();
  const [rooms, setRooms] = useState<FloorRoomLayout[]>(initialRooms);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(initialRooms[0]?.id ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quickCount, setQuickCount] = useState("8");

  const totalTables = rooms.reduce((n, r) => n + r.tables.length, 0);
  const activeRoom = rooms.find((r) => r.id === activeRoomId) ?? null;
  const selected = activeRoom?.tables.find((t) => t.id === selectedId) ?? null;

  const canvasRef = useRef<HTMLDivElement>(null);

  function fail(err: unknown) {
    setError(err instanceof Error ? err.message : "Something went wrong.");
    router.refresh(); // resync from the server on any failed write
  }

  // ── Local-state helpers (optimistic; server persists in the background) ──────
  const patchTable = useCallback(
    (tableId: string, patch: Partial<FloorTableLayout>) => {
      setRooms((rs) =>
        rs.map((r) =>
          r.id !== activeRoomId
            ? r
            : { ...r, tables: r.tables.map((t) => (t.id === tableId ? { ...t, ...patch } : t)) },
        ),
      );
    },
    [activeRoomId],
  );

  // ── Rooms ──────────────────────────────────────────────────────────────────
  async function onAddRoom() {
    setError(null);
    const name = window.prompt("Room name (e.g. Main, Patio, Bar)")?.trim();
    if (!name) return;
    try {
      const id = await createRoom({ businessId, name });
      setRooms((rs) => [...rs, { id, name, sortOrder: rs.length, tables: [] }]);
      setActiveRoomId(id);
    } catch (err) {
      fail(err);
    }
  }

  async function onRenameRoom(room: FloorRoomLayout) {
    setError(null);
    const name = window.prompt("Rename room", room.name)?.trim();
    if (!name || name === room.name) return;
    try {
      await renameRoom({ businessId, id: room.id, name });
      setRooms((rs) => rs.map((r) => (r.id === room.id ? { ...r, name } : r)));
    } catch (err) {
      fail(err);
    }
  }

  async function onDeleteRoom(room: FloorRoomLayout) {
    const ok = await confirm({
      title: `Delete "${room.name}"?`,
      description: `This removes the room and its ${room.tables.length} table(s).`,
      confirmLabel: "Delete room",
    });
    if (!ok) return;
    try {
      await deleteRoom({ businessId, id: room.id });
      setRooms((rs) => {
        const next = rs.filter((r) => r.id !== room.id);
        if (activeRoomId === room.id) setActiveRoomId(next[0]?.id ?? null);
        return next;
      });
    } catch (err) {
      fail(err);
    }
  }

  // ── Tables ───────────────────────────────────────────────────────────────────
  async function onAddTable() {
    if (!activeRoom) return;
    setError(null);
    if (totalTables >= MAX_TABLES_PER_BUSINESS) {
      setError(`Table limit reached (${MAX_TABLES_PER_BUSINESS}).`);
      return;
    }
    const label = `T${totalTables + 1}`;
    try {
      const id = await createTable({
        businessId,
        roomId: activeRoom.id,
        label,
        shape: "SQUARE",
        seats: 4,
        x: 60,
        y: 60,
        width: 80,
        height: 80,
      });
      const table: FloorTableLayout = { id, label, shape: "SQUARE", x: 60, y: 60, width: 80, height: 80, seats: 4 };
      setRooms((rs) => rs.map((r) => (r.id === activeRoom.id ? { ...r, tables: [...r.tables, table] } : r)));
      setSelectedId(id);
    } catch (err) {
      fail(err);
    }
  }

  async function onQuickAdd() {
    if (!activeRoom) return;
    setError(null);
    const count = Math.max(1, Math.min(MAX_TABLES_PER_BUSINESS, parseInt(quickCount || "0", 10) || 0));
    if (totalTables + count > MAX_TABLES_PER_BUSINESS) {
      setError(`That exceeds the ${MAX_TABLES_PER_BUSINESS}-table limit (you have ${totalTables}).`);
      return;
    }
    try {
      const created = await quickAddTables({ businessId, roomId: activeRoom.id, count, seats: 4 });
      setRooms((rs) =>
        rs.map((r) =>
          r.id === activeRoom.id ? { ...r, tables: [...r.tables, ...(created as FloorTableLayout[])] } : r,
        ),
      );
    } catch (err) {
      fail(err);
    }
  }

  async function onDeleteTable(table: FloorTableLayout) {
    const ok = await confirm({ title: `Delete table "${table.label}"?`, confirmLabel: "Delete" });
    if (!ok) return;
    try {
      await deleteTable({ businessId, id: table.id });
      setRooms((rs) =>
        rs.map((r) => (r.id === activeRoomId ? { ...r, tables: r.tables.filter((t) => t.id !== table.id) } : r)),
      );
      if (selectedId === table.id) setSelectedId(null);
    } catch (err) {
      fail(err);
    }
  }

  // Persist an inspector edit immediately.
  async function commitTable(tableId: string, patch: Partial<FloorTableLayout>) {
    patchTable(tableId, patch);
    try {
      await updateTable({ businessId, id: tableId, ...patch });
    } catch (err) {
      fail(err);
    }
  }

  // ── Drag / resize via native pointer events ──────────────────────────────────
  function scaleFromCanvas(): number {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect && rect.width > 0 ? rect.width / FLOOR_WIDTH : 1;
  }

  function startDrag(e: React.PointerEvent, table: FloorTableLayout) {
    e.preventDefault();
    setSelectedId(table.id);
    const scale = scaleFromCanvas();
    const startX = e.clientX;
    const startY = e.clientY;
    const originX = table.x;
    const originY = table.y;
    let latest = { x: originX, y: originY };
    (e.target as Element).setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const x = clamp(originX + (ev.clientX - startX) / scale, 0, FLOOR_WIDTH - table.width);
      const y = clamp(originY + (ev.clientY - startY) / scale, 0, FLOOR_HEIGHT - table.height);
      latest = { x, y };
      patchTable(table.id, { x, y });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest.x !== originX || latest.y !== originY) void commitTable(table.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startResize(e: React.PointerEvent, table: FloorTableLayout) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(table.id);
    const scale = scaleFromCanvas();
    const startX = e.clientX;
    const startY = e.clientY;
    const originW = table.width;
    const originH = table.height;
    let latest = { width: originW, height: originH };

    const move = (ev: PointerEvent) => {
      const width = clamp(originW + (ev.clientX - startX) / scale, MIN_TABLE_SIZE, MAX_TABLE_SIZE);
      const height = clamp(originH + (ev.clientY - startY) / scale, MIN_TABLE_SIZE, MAX_TABLE_SIZE);
      latest = { width, height };
      patchTable(table.id, { width, height });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (latest.width !== originW || latest.height !== originH) void commitTable(table.id, latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const pct = (n: number, total: number) => `${(n / total) * 100}%`;

  return (
    <div className="space-y-4">
      {confirmEl}

      {/* Room tabs */}
      <div className="flex flex-wrap items-center gap-2">
        {rooms.map((room) => (
          <button
            key={room.id}
            type="button"
            onClick={() => {
              setActiveRoomId(room.id);
              setSelectedId(null);
            }}
            className={`inline-flex h-10 items-center rounded-full px-4 text-sm font-medium ${
              room.id === activeRoomId
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {room.name}
            <span className="ml-2 rounded-full bg-black/10 px-1.5 text-xs">{room.tables.length}</span>
          </button>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={onAddRoom}>
          <Plus size={16} /> Add room
        </Button>
      </div>

      {rooms.length === 0 ? (
        <EmptyState onAddRoom={onAddRoom} />
      ) : !activeRoom ? null : (
        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          {/* Canvas */}
          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{activeRoom.name}</span>
                <Button type="button" variant="ghost" size="icon" aria-label="Rename room" onClick={() => onRenameRoom(activeRoom)}>
                  <Pencil size={15} />
                </Button>
                <Button type="button" variant="ghost" size="icon" aria-label="Delete room" onClick={() => onDeleteRoom(activeRoom)}>
                  <Trash2 size={15} />
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="Quick-add count"
                  inputMode="numeric"
                  value={quickCount}
                  onChange={(e) => setQuickCount(e.target.value)}
                  className="h-9 w-16 numeric"
                />
                <Button type="button" variant="outline" size="sm" onClick={onQuickAdd}>
                  Quick-add
                </Button>
                <Button type="button" size="sm" onClick={onAddTable}>
                  <Plus size={16} /> Table
                </Button>
              </div>
            </div>

            <div
              ref={canvasRef}
              onPointerDown={() => setSelectedId(null)}
              className="relative w-full overflow-hidden rounded-xl border border-border bg-muted/40"
              style={{ aspectRatio: `${FLOOR_WIDTH} / ${FLOOR_HEIGHT}`, touchAction: "none" }}
            >
              {activeRoom.tables.length === 0 && (
                <p className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  No tables yet — use <span className="mx-1 font-medium text-foreground">Quick-add</span> or{" "}
                  <span className="mx-1 font-medium text-foreground">+ Table</span>, then drag to match your room.
                </p>
              )}
              {activeRoom.tables.map((t) => (
                <div
                  key={t.id}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    startDrag(e, t);
                  }}
                  className={`absolute flex cursor-grab touch-none select-none items-center justify-center border-2 text-center text-xs font-semibold shadow-sm active:cursor-grabbing ${
                    selectedId === t.id
                      ? "border-primary bg-primary/15 text-foreground ring-2 ring-primary"
                      : "border-border bg-card text-foreground"
                  }`}
                  style={{
                    left: pct(t.x, FLOOR_WIDTH),
                    top: pct(t.y, FLOOR_HEIGHT),
                    width: pct(t.width, FLOOR_WIDTH),
                    height: pct(t.height, FLOOR_HEIGHT),
                    borderRadius: shapeRadius(t.shape),
                  }}
                >
                  <span className="pointer-events-none leading-tight">
                    {t.label}
                    <span className="block text-[10px] font-normal text-muted-foreground">{t.seats} seats</span>
                  </span>
                  {selectedId === t.id && (
                    <span
                      role="slider"
                      aria-label="Resize table"
                      aria-valuenow={t.width}
                      tabIndex={0}
                      onPointerDown={(e) => startResize(e, t)}
                      className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-primary bg-card"
                    />
                  )}
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Drag a table to move it; drag the corner dot to resize. {totalTables}/{MAX_TABLES_PER_BUSINESS} tables.
            </p>
          </div>

          {/* Inspector */}
          <div className="rounded-xl border border-border bg-card p-4">
            {selected ? (
              <div className="space-y-4">
                <div>
                  <Label htmlFor="tbl-label">Label</Label>
                  <Input
                    id="tbl-label"
                    value={selected.label}
                    onChange={(e) => patchTable(selected.id, { label: e.target.value })}
                    onBlur={(e) => commitTable(selected.id, { label: e.target.value.trim().slice(0, 12) || selected.label })}
                  />
                </div>
                <div>
                  <Label htmlFor="tbl-seats">Seats</Label>
                  <Input
                    id="tbl-seats"
                    inputMode="numeric"
                    className="numeric"
                    value={String(selected.seats)}
                    onChange={(e) => patchTable(selected.id, { seats: parseInt(e.target.value || "0", 10) || 0 })}
                    onBlur={(e) =>
                      commitTable(selected.id, { seats: clamp(parseInt(e.target.value || "0", 10) || 0, 0, 40) })
                    }
                  />
                </div>
                <div>
                  <Label>Shape</Label>
                  <div className="mt-1 grid grid-cols-3 gap-2">
                    {SHAPES.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => commitTable(selected.id, { shape: s })}
                        className={`h-10 rounded-md border text-xs font-medium capitalize ${
                          selected.shape === s ? "border-primary bg-primary/10" : "border-input hover:bg-muted"
                        }`}
                      >
                        {s.toLowerCase()}
                      </button>
                    ))}
                  </div>
                </div>
                <Button type="button" variant="destructive" size="sm" className="w-full" onClick={() => onDeleteTable(selected)}>
                  <Trash2 size={15} /> Delete table
                </Button>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Select a table to edit its label, seats, and shape.</p>
            )}
          </div>
        </div>
      )}

      {error && (
        <p className="text-sm font-medium text-destructive" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

function EmptyState({ onAddRoom }: { onAddRoom: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center">
      <h3 className="text-lg font-bold">Set up your dining room</h3>
      <ol className="mx-auto mt-3 max-w-sm space-y-1 text-left text-sm text-muted-foreground">
        <li>
          <span className="font-semibold text-foreground">1 ·</span> Add a room (Main, Patio, Bar…).
        </li>
        <li>
          <span className="font-semibold text-foreground">2 ·</span> Quick-add tables, or add them one at a time.
        </li>
        <li>
          <span className="font-semibold text-foreground">3 ·</span> Drag each table to match your real layout.
        </li>
      </ol>
      <Button type="button" className="mt-4" onClick={onAddRoom}>
        <Plus size={16} /> Add your first room
      </Button>
    </div>
  );
}
