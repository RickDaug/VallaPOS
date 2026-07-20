"use client";

import { type FormEvent, useEffect, useState } from "react";
import { getLocalStore, isLocalStoreReady } from "@/lib/data-store/local-runtime";
import { LOCAL_BUSINESS_ID } from "@/lib/edition";
import { CURRENCIES, TIMEZONE_OPTIONS } from "@/features/settings/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { BusinessSettingsRow } from "@/lib/data-store/sqlite/sqlite-store";
import { loadPrinterConfig, savePrinterConfig } from "@/features/peripherals/native-print";
import {
  DEFAULT_PRINTER_CONFIG,
  PRINTER_KINDS,
  type PrinterConfig,
  type PrinterKind,
} from "@/features/peripherals/printer-config";

/**
 * Offline-edition Settings (docs/EDITIONS.md §5b) — edit the single local
 * business's name, tax, currency, timezone, and register modes. Reads/writes go
 * straight through the local store's `getBusinessSettings`/`updateBusinessSettings`;
 * there is no server action (banned under `output:'export'`). Tax is stored in
 * basis points (825 = 8.25%) — the UI shows a percent and converts on save.
 */
const bpsToPercent = (bps: number) => (bps / 100).toString();
const percentToBps = (s: string) => Math.round((parseFloat(s) || 0) * 100);

const PRINTER_KIND_LABELS: Record<PrinterKind, string> = {
  tcp: "Network (TCP/IP)",
  windows_spooler: "Windows printer",
  serial: "Serial (COM)",
};
const PRINTER_ADDRESS_HINT: Record<PrinterKind, string> = {
  tcp: "192.168.1.50  (or host:9100)",
  windows_spooler: "Installed printer name",
  serial: "COM3  /  /dev/ttyUSB0",
};

export default function LocalSettingsPage() {
  const [form, setForm] = useState<BusinessSettingsRow | null>(null);
  const [taxPercent, setTaxPercent] = useState("0");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const [printer, setPrinter] = useState<PrinterConfig>(DEFAULT_PRINTER_CONFIG);
  const [printerBusy, setPrinterBusy] = useState(false);
  const [printerSaved, setPrinterSaved] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => {
      if (!isLocalStoreReady()) {
        window.setTimeout(load, 100);
        return;
      }
      getLocalStore()
        .store.getBusinessSettings(LOCAL_BUSINESS_ID)
        .then((s) => {
          if (!active || !s) return;
          setForm(s);
          setTaxPercent(bpsToPercent(s.taxRateBps));
        });
    };
    load();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadPrinterConfig().then((cfg) => {
      if (active) setPrinter(cfg);
    });
    return () => {
      active = false;
    };
  }, []);

  function patch(next: Partial<BusinessSettingsRow>) {
    setForm((f) => (f ? { ...f, ...next } : f));
    setSaved(false);
  }

  function patchPrinter(next: Partial<PrinterConfig>) {
    setPrinter((p) => ({ ...p, ...next }));
    setPrinterSaved(false);
  }

  async function savePrinter(e: FormEvent) {
    e.preventDefault();
    setPrinterBusy(true);
    await savePrinterConfig({ ...printer, address: printer.address.trim() });
    setPrinterBusy(false);
    setPrinterSaved(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setBusy(true);
    const next = { ...form, taxRateBps: percentToBps(taxPercent) };
    await getLocalStore().store.updateBusinessSettings(LOCAL_BUSINESS_ID, next);
    setForm(next);
    setBusy(false);
    setSaved(true);
  }

  if (!form) return <p className="text-muted-foreground text-sm">Loading settings&hellip;</p>;

  return (
    <section className="max-w-xl">
      <h1 className="mb-6 text-2xl font-black md:text-3xl">Settings</h1>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={save} className="flex flex-col gap-4">
            <label className="text-sm font-medium">
              Business name
              <input
                value={form.name}
                onChange={(e) => patch({ name: e.target.value })}
                className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>

            <div className="flex flex-wrap gap-4">
              <label className="w-32 text-sm font-medium">
                Tax rate (%)
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={taxPercent}
                  onChange={(e) => {
                    setTaxPercent(e.target.value);
                    setSaved(false);
                  }}
                  className="border-border bg-background numeric mt-1 w-full rounded-lg border px-3 py-2 text-right"
                />
              </label>

              <label className="w-32 text-sm font-medium">
                Currency
                <select
                  value={form.currency}
                  onChange={(e) => patch({ currency: e.target.value })}
                  className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="flex-1 text-sm font-medium">
                Timezone
                <select
                  value={form.timezone}
                  onChange={(e) => patch({ timezone: e.target.value })}
                  className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
                >
                  {TIMEZONE_OPTIONS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.taxInclusive}
                onChange={(e) => patch({ taxInclusive: e.target.checked })}
                className="size-4"
              />
              Prices include tax
            </label>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={form.singleOperatorMode}
                onChange={(e) => patch({ singleOperatorMode: e.target.checked })}
                className="size-4"
              />
              Single-operator mode (skip the staff PIN prompt)
            </label>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={busy}>
                {busy ? "Saving…" : "Save settings"}
              </Button>
              {saved ? <span className="text-muted-foreground text-sm">Saved.</span> : null}
            </div>
          </form>
        </CardContent>
      </Card>

      <h2 className="mt-8 mb-3 text-lg font-black">Receipt printer</h2>
      <Card>
        <CardContent className="p-4">
          <form onSubmit={savePrinter} className="flex flex-col gap-4">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={printer.enabled}
                onChange={(e) => patchPrinter({ enabled: e.target.checked })}
                className="size-4"
              />
              Auto-print a receipt after each sale
            </label>

            <div className="flex flex-wrap gap-4">
              <label className="w-44 text-sm font-medium">
                Connection
                <select
                  value={printer.kind}
                  onChange={(e) => patchPrinter({ kind: e.target.value as PrinterKind })}
                  className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
                >
                  {PRINTER_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {PRINTER_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="w-24 text-sm font-medium">
                Paper
                <select
                  value={printer.paperWidth}
                  onChange={(e) => patchPrinter({ paperWidth: Number(e.target.value) as 58 | 80 })}
                  className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
                >
                  <option value={80}>80mm</option>
                  <option value={58}>58mm</option>
                </select>
              </label>
            </div>

            <label className="text-sm font-medium">
              Printer address
              <input
                value={printer.address}
                onChange={(e) => patchPrinter({ address: e.target.value })}
                placeholder={PRINTER_ADDRESS_HINT[printer.kind]}
                className="border-border bg-background mt-1 w-full rounded-lg border px-3 py-2"
              />
            </label>

            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={printer.openDrawer}
                onChange={(e) => patchPrinter({ openDrawer: e.target.checked })}
                className="size-4"
              />
              Open the cash drawer when printing
            </label>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={printerBusy}>
                {printerBusy ? "Saving…" : "Save printer"}
              </Button>
              {printerSaved ? <span className="text-muted-foreground text-sm">Saved.</span> : null}
            </div>
            <p className="text-muted-foreground text-xs">
              Receipts also stay printable from the Orders screen. Network printers use raw port
              9100 and Windows printers print through the spooler (RAW); the serial transport is
              still being finished.
            </p>
          </form>
        </CardContent>
      </Card>
    </section>
  );
}
