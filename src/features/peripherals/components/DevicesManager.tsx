"use client";

/**
 * Devices (printer) settings screen — the Phase-1 integration surface that wires
 * the peripherals stack (WebUSB transport + ESC/POS formatter + receipt preview)
 * into a usable UI.
 *
 * Hardware-free where it counts: **Test print always renders an on-screen receipt
 * preview** (from `preview()`), so the whole layout/QR/cut/drawer flow is visible
 * with NO printer attached. When a real Epson/Star unit IS connected (one-time
 * "Add printer" permission picker → picker-free auto-reconnect after), the same
 * bytes are also sent to it.
 *
 * Marked Beta and gated to settings-managers; it does NOT touch the live checkout
 * path (auto-print-on-sale stays behind the default-OFF PERIPHERALS_V2 flag).
 */

import { useCallback, useEffect, useState } from "react";
import { Printer, Plug, Inbox, TriangleAlert, ScrollText } from "lucide-react";
import { WebUsbTransport, WebUsbUnsupportedError } from "@/features/peripherals/transports/webusb";
import type { PeripheralDevice } from "@/features/peripherals/types";
import { preview, type Preview } from "@/features/peripherals/preview";
import { formatReceipt, type EscPosReceipt } from "@/features/peripherals/escpos";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** A representative sample sale used for the Test print / preview. */
function sampleReceipt(businessName: string): EscPosReceipt {
  return {
    businessName,
    orderNumber: 1001,
    createdAt: new Date().toLocaleString("en-US"),
    currency: "USD",
    customerName: null,
    lines: [
      {
        name: "Classic Burger",
        quantity: 1,
        unitPriceCents: 999,
        lineTotalCents: 999,
        modifiers: [{ name: "Medium", priceDeltaCents: 0 }],
      },
      { name: "Soda — Large", quantity: 2, unitPriceCents: 299, lineTotalCents: 598 },
    ],
    subtotalCents: 1597,
    discountCents: 0,
    taxCents: 132,
    tipCents: 0,
    totalCents: 1729,
    payments: [
      { methodLabel: "Cash", amountCents: 1729, tenderedCents: 2000, changeCents: 271, note: null },
    ],
    qrValue: null,
    footer: "Test print · VallaPOS",
  };
}

/** Turn a thrown transport error into a cashier-friendly message. */
function humanizeError(err: unknown): string {
  if (err instanceof WebUsbUnsupportedError) {
    return "This browser/device can't talk to USB printers. Use Chrome on Android/Windows, or set up a network (CloudPRNT) printer.";
  }
  const msg = err instanceof Error ? err.message : String(err);
  if (/access denied|claiminterface|protected/i.test(msg)) {
    return "Windows is holding this printer with its own driver. Swap it to the generic WinUSB driver (Zadig) so the browser can use it — or use a network/CloudPRNT printer instead.";
  }
  if (/no device selected|cancell?ed/i.test(msg)) return "No printer selected.";
  return msg;
}

export function DevicesManager({ businessName }: { businessName: string }) {
  const { toast } = useToast();
  const [transport] = useState(() => new WebUsbTransport());
  const [supported, setSupported] = useState(true);
  const [device, setDevice] = useState<PeripheralDevice | null>(null);
  const [previewData, setPreviewData] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  const buildBytes = useCallback(
    (openDrawer: boolean) =>
      formatReceipt(sampleReceipt(businessName), {
        paperWidth: device?.capabilities.paperWidthMm ?? 80,
        openDrawer,
      }).bytes,
    [businessName, device],
  );

  // On mount: report WebUSB support and auto-reconnect any already-granted device
  // (no picker — the browser remembers the permission across sessions).
  useEffect(() => {
    setSupported(transport.isSupported);
    let cancelled = false;
    void (async () => {
      try {
        const known = await transport.getKnownDevices();
        if (!cancelled && known[0]) {
          const d = await transport.connectDevice(known[0].device);
          if (!cancelled) setDevice(d);
        }
      } catch {
        /* nothing granted / not reconnectable — stay disconnected */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [transport]);

  async function addPrinter() {
    try {
      const usbDev = await transport.requestDevice(); // one-time picker (user gesture)
      const d = await transport.connectDevice(usbDev);
      setDevice(d);
      toast({ title: `Connected ${d.identity.model}`, variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't connect the printer", description: humanizeError(err), variant: "error" });
    }
  }

  async function disconnect() {
    try {
      await device?.disconnect();
    } catch {
      /* best effort */
    }
    setDevice(null);
  }

  async function testPrint() {
    const bytes = buildBytes(false);
    setPreviewData(preview(bytes)); // ALWAYS preview — works with no printer
    if (!device) {
      toast({ title: "Preview rendered", description: "Connect a printer to print for real.", variant: "default" });
      return;
    }
    setBusy(true);
    try {
      await device.print(bytes);
      toast({ title: "Sent to printer", variant: "success" });
    } catch (err) {
      toast({ title: "Print failed", description: humanizeError(err), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  async function openDrawer() {
    if (!device) return;
    setBusy(true);
    try {
      await device.kickDrawer();
      toast({ title: "Drawer kick sent", variant: "success" });
    } catch (err) {
      toast({ title: "Couldn't open the drawer", description: humanizeError(err), variant: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-5 p-5 md:p-6">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground">Receipt printer</h3>
          <Badge variant="warning">Beta</Badge>
        </div>

        {!supported && (
          <p className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-foreground">
            <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
            This browser can&apos;t connect USB printers. Use <b>Chrome on Android or Windows</b>, or
            a network (CloudPRNT) printer.
          </p>
        )}

        {/* Connected device card */}
        {device ? (
          <div className="flex items-center justify-between rounded-lg border border-success/40 bg-success/5 p-3">
            <div className="flex items-center gap-3">
              <Printer size={20} className="text-success" />
              <div>
                <p className="font-semibold">{device.identity.model}</p>
                <p className="text-xs text-muted-foreground">
                  {device.capabilities.paperWidthMm}mm
                  {device.capabilities.hasCutter && " · auto-cut"}
                  {device.capabilities.hasDrawerKick && " · drawer"}
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="flex items-center justify-between rounded-lg border border-border bg-muted p-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <Inbox size={18} /> No printer connected
            </span>
            <Button onClick={addPrinter} disabled={!supported} className="gap-2">
              <Plug size={16} /> Add printer
            </Button>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={testPrint} disabled={busy} className="gap-2">
            <ScrollText size={16} /> Test print
          </Button>
          <Button
            variant="outline"
            onClick={openDrawer}
            disabled={busy || !device || !device.capabilities.hasDrawerKick}
            className="gap-2"
          >
            <Inbox size={16} /> Open drawer
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Add a printer once (a browser permission prompt) — it reconnects automatically after.
          <b> Test print</b> shows the on-screen receipt below even with no printer attached.
        </p>

        {/* On-screen receipt preview */}
        {previewData && (
          <div>
            <p className="mb-2 text-sm font-medium">Preview</p>
            <PreviewReceipt data={previewData} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Render a structured ESC/POS preview as a faithful little paper receipt. */
function PreviewReceipt({ data }: { data: Preview }) {
  return (
    <div className="mx-auto w-[300px] rounded-md border border-border bg-white p-3 font-mono text-[11px] leading-snug text-black shadow-inner">
      {data.nodes.map((node, i) => {
        if (node.kind === "line") {
          return (
            <div
              key={i}
              className={cn(
                "whitespace-pre-wrap break-words",
                node.align === "center" && "text-center",
                node.align === "right" && "text-right",
                node.bold && "font-bold",
                (node.size === "double" || node.size === "double-height") && "text-[15px]",
              )}
            >
              {node.text || " "}
            </div>
          );
        }
        if (node.kind === "qr") {
          return (
            <div key={i} className="my-1 text-center text-[10px] text-gray-500">
              ▣ QR code{node.data ? ` · ${node.data.slice(0, 28)}${node.data.length > 28 ? "…" : ""}` : ""}
            </div>
          );
        }
        if (node.kind === "cut") {
          return (
            <div
              key={i}
              className="my-1 border-t border-dashed border-gray-400 pt-0.5 text-center text-[9px] text-gray-400"
            >
              ✂ cut
            </div>
          );
        }
        return (
          <div key={i} className="my-1 text-center text-[9px] text-gray-400">
            ⊟ drawer kick
          </div>
        );
      })}
    </div>
  );
}
