"use client";

import { type FormEvent, useEffect, useState } from "react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { OperatorRow } from "@/lib/data-store/sqlite/sqlite-store";

/**
 * Offline-edition Staff (docs/EDITIONS.md §5b) — add operators and set/replace
 * their 4-digit PIN so the register can attribute sales. Writes go through the
 * local store's `addOperator`/`setOperatorPin`/`deactivateOperator`. Cloud manages
 * staff via Membership invites; this screen is local-only. A PIN is optional —
 * an operator with none simply can't be selected until one is set.
 */
const isPin = (s: string) => /^\d{4,6}$/.test(s);

export default function LocalEmployeesPage() {
  const [operators, setOperators] = useState<OperatorRow[] | null>(null);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pinValue, setPinValue] = useState("");

  const refresh = () => getLocalStore().store.listOperators(LOCAL_BUSINESS_ID).then(setOperators);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      getLocalStore()
        .store.listOperators(LOCAL_BUSINESS_ID)
        .then((o) => {
          if (active) setOperators(o);
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (pin && !isPin(pin)) return;
    setBusy(true);
    await getLocalStore().store.addOperator(LOCAL_BUSINESS_ID, {
      name: name.trim(),
      pin: pin || undefined,
    });
    setName("");
    setPin("");
    await refresh();
    setBusy(false);
  }

  async function savePin(operatorId: string) {
    if (!isPin(pinValue)) return;
    await getLocalStore().store.setOperatorPin(LOCAL_BUSINESS_ID, operatorId, pinValue);
    setPinFor(null);
    setPinValue("");
    await refresh();
  }

  async function remove(operatorId: string) {
    await getLocalStore().store.deactivateOperator(LOCAL_BUSINESS_ID, operatorId);
    await refresh();
  }

  if (!operators) return <p className="text-muted-foreground text-sm">Loading staff&hellip;</p>;

  return (
    <section className="max-w-2xl">
      <h1 className="mb-6 text-2xl font-black md:text-3xl">Staff</h1>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={add} className="flex flex-wrap items-end gap-2">
            <label className="flex-1 text-sm font-medium">
              Name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Rosa"
                className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <label className="w-32 text-sm font-medium">
              PIN (optional)
              <input
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="4–6 digits"
                className="border-border bg-background numeric mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>
            <Button type="submit" disabled={busy || !name.trim() || (pin !== "" && !isPin(pin))}>
              {busy ? "Adding…" : "Add staff"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <ul className="mt-4 space-y-2">
        {operators.map((op) => (
          <li key={op.id} className="border-border rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium">{op.name}</span>
              <div className="flex items-center gap-4">
                <button
                  onClick={() => {
                    setPinFor(pinFor === op.id ? null : op.id);
                    setPinValue("");
                  }}
                  className="text-primary text-sm font-medium hover:underline"
                >
                  Set PIN
                </button>
                <button
                  onClick={() => remove(op.id)}
                  className="text-destructive text-sm font-medium hover:underline"
                >
                  Remove
                </button>
              </div>
            </div>
            {pinFor === op.id ? (
              <div className="mt-3 flex items-center gap-2">
                <input
                  autoFocus
                  inputMode="numeric"
                  value={pinValue}
                  onChange={(e) => setPinValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="New 4–6 digit PIN"
                  className="border-border bg-background numeric w-40 rounded-lg border px-3 py-2"
                />
                <Button onClick={() => savePin(op.id)} disabled={!isPin(pinValue)} size="sm">
                  Save PIN
                </Button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
