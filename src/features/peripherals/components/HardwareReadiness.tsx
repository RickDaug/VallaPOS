"use client";

/**
 * Hardware Readiness — a hardware-free self-check a merchant can run on their own
 * phone/laptop to see, in ~30 seconds, whether THIS browser+device can drive the
 * peripherals VallaPOS supports. No purchase required to get value:
 *
 *  - Capability panel: secure context + the Chromium device APIs (WebUSB / WebHID
 *    / Web Serial / Web Bluetooth) that gate USB printers, drawers, and some
 *    scanners. Pure feature detection — accurate for the exact browser they're on.
 *  - Scanner tester: focus the box and scan anything. A hardware barcode scanner
 *    is a keyboard "wedge" (it types the code + Enter very fast), so we can detect
 *    it by keystroke timing — this works with a REAL scanner and needs zero setup
 *    or integration. Manual typing is correctly flagged as "not a scanner".
 *
 * The receipt-printer preview lives in the "Receipt printer" card on this same
 * page (DevicesManager) — together they cover the full picture.
 *
 * Beta, manage_settings-gated (the Settings page gates rendering). Client-only:
 * every `navigator.*` read is in an effect/handler, never during SSR.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Usb,
  Bluetooth,
  Cable,
  ScanLine,
  Barcode,
  ShieldCheck,
  Check,
  X,
  Copy,
  MonitorSmartphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface Capability {
  key: string;
  label: string;
  icon: typeof Usb;
  supported: boolean;
  /** What this capability unlocks, or how to work around it when missing. */
  note: string;
}

interface Environment {
  secureContext: boolean;
  chromium: boolean;
  platform: string;
  caps: Capability[];
}

/** Read the current browser's peripheral capabilities. Client-only. */
function readEnvironment(): Environment {
  const nav = navigator as Navigator & {
    usb?: unknown;
    hid?: unknown;
    serial?: unknown;
    bluetooth?: unknown;
    userAgentData?: { platform?: string; brands?: { brand: string }[] };
  };
  const uaData = nav.userAgentData;
  const chromium = Boolean(
    uaData?.brands?.some((b) => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand)) ??
      /Chrome\//.test(nav.userAgent),
  );
  const platform = uaData?.platform || nav.platform || "unknown";

  const caps: Capability[] = [
    {
      key: "usb",
      label: "WebUSB",
      icon: Usb,
      supported: "usb" in nav,
      note: "USB receipt printers (Epson/Star) + cash-drawer kick.",
    },
    {
      key: "hid",
      label: "WebHID",
      icon: ScanLine,
      supported: "hid" in nav,
      note: "Scanners in HID-POS mode (most scanners don't need this — see below).",
    },
    {
      key: "serial",
      label: "Web Serial",
      icon: Cable,
      supported: "serial" in nav,
      note: "Serial/USB-serial printers & scales.",
    },
    {
      key: "bluetooth",
      label: "Web Bluetooth",
      icon: Bluetooth,
      supported: "bluetooth" in nav,
      note: "Bluetooth printers/scanners (Chromium only).",
    },
  ];

  return { secureContext: window.isSecureContext, chromium, platform, caps };
}

// ── Scanner tester ───────────────────────────────────────────────────────────

interface ScanResult {
  code: string;
  chars: number;
  /** Milliseconds from first to last keystroke. */
  totalMs: number;
  /** Average ms between keystrokes — the tell: scanners are very fast (<~30ms). */
  perKeyMs: number;
  isScanner: boolean;
}

/** A hardware wedge scanner types the whole code in a tight burst. */
const SCANNER_MAX_PER_KEY_MS = 30;
const SCANNER_MIN_CHARS = 3;

export function HardwareReadiness() {
  const { toast } = useToast();
  const [env, setEnv] = useState<Environment | null>(null);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [value, setValue] = useState("");
  const stamps = useRef<number[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEnv(readEnvironment());
  }, []);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const times = stamps.current;
      const code = e.currentTarget.value;
      if (code.length > 0 && times.length >= 1) {
        const totalMs = times.length > 1 ? times[times.length - 1]! - times[0]! : 0;
        const perKeyMs = times.length > 1 ? totalMs / (times.length - 1) : 0;
        const isScanner = code.length >= SCANNER_MIN_CHARS && perKeyMs > 0 && perKeyMs <= SCANNER_MAX_PER_KEY_MS;
        setScan({ code, chars: code.length, totalMs, perKeyMs, isScanner });
      }
      stamps.current = [];
      setValue("");
      e.preventDefault();
      return;
    }
    if (e.key.length === 1) {
      // performance.now() is monotonic and allowed; record one stamp per char key.
      stamps.current.push(performance.now());
    }
  }, []);

  function copyDiagnostics() {
    if (!env) return;
    const lines = [
      `VallaPOS Hardware Readiness`,
      `platform: ${env.platform}  chromium: ${env.chromium}  secureContext: ${env.secureContext}`,
      ...env.caps.map((c) => `${c.label}: ${c.supported ? "yes" : "no"}`),
      scan ? `lastScan: ${scan.chars} chars @ ${Math.round(scan.perKeyMs)}ms/key → ${scan.isScanner ? "scanner" : "manual"}` : `lastScan: (none)`,
    ];
    void navigator.clipboard
      ?.writeText(lines.join("\n"))
      .then(() => toast({ title: "Diagnostics copied", variant: "success" }))
      .catch(() => toast({ title: "Couldn't copy", variant: "error" }));
  }

  if (!env) {
    return (
      <Card className="max-w-lg">
        <CardContent className="p-6 text-sm text-muted-foreground">Checking this device…</CardContent>
      </Card>
    );
  }

  const usbCap = env.caps.find((c) => c.key === "usb");

  return (
    <Card className="max-w-lg">
      <CardContent className="space-y-6 p-5 md:p-6">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-foreground">Hardware readiness</h3>
          <Badge variant="warning">Beta</Badge>
        </div>

        {/* Environment summary */}
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <Row
            ok={env.secureContext}
            icon={ShieldCheck}
            label="Secure connection (HTTPS)"
            hint={env.secureContext ? "Required for device access — good." : "Device APIs are blocked without HTTPS."}
          />
          <Row
            ok={env.chromium}
            icon={MonitorSmartphone}
            label={`Chromium browser · ${env.platform}`}
            hint={
              env.chromium
                ? "Supports the device APIs."
                : "Use Chrome or Edge — Safari/Firefox don't expose USB/Bluetooth/Serial."
            }
          />
        </div>

        {/* Capability list */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Device connections in this browser</p>
          <div className="divide-y divide-border rounded-lg border border-border">
            {env.caps.map((c) => (
              <div key={c.key} className="flex items-start gap-3 p-3">
                <c.icon size={18} className="mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{c.label}</span>
                    {c.supported ? (
                      <Badge variant="success" className="gap-1">
                        <Check size={12} /> Supported
                      </Badge>
                    ) : (
                      <Badge variant="muted" className="gap-1">
                        <X size={12} /> Not available
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{c.note}</p>
                </div>
              </div>
            ))}
          </div>
          {usbCap && !usbCap.supported && (
            <p className="text-xs text-muted-foreground">
              No WebUSB here? You can still print via a <b>network (CloudPRNT) printer</b>, which needs
              no browser device access at all.
            </p>
          )}
        </div>

        {/* Scanner tester */}
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium">
            <Barcode size={16} /> Barcode scanner test
          </p>
          <p className="text-xs text-muted-foreground">
            Click the box and <b>scan any barcode</b> (or type + Enter). Hardware scanners work
            everywhere with no setup — they just type. We measure the speed to tell a real scanner
            from manual typing.
          </p>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Focus here, then scan…"
            aria-label="Scanner test input"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/30"
          />
          {scan && (
            <div
              className={cn(
                "rounded-lg border p-3 text-sm",
                scan.isScanner
                  ? "border-success/40 bg-success/5"
                  : "border-border bg-muted/40",
              )}
            >
              <div className="flex items-center gap-2">
                {scan.isScanner ? (
                  <Badge variant="success" className="gap-1">
                    <Check size={12} /> Hardware scanner detected
                  </Badge>
                ) : (
                  <Badge variant="muted">Looks like manual typing</Badge>
                )}
              </div>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                <dt>Captured</dt>
                <dd className="truncate font-mono text-foreground">{scan.code}</dd>
                <dt>Length</dt>
                <dd>{scan.chars} chars</dd>
                <dt>Speed</dt>
                <dd>{Math.round(scan.perKeyMs)} ms/key ({Math.round(scan.totalMs)} ms total)</dd>
              </dl>
            </div>
          )}
        </div>

        <div>
          <Button variant="outline" size="sm" onClick={copyDiagnostics} className="gap-2">
            <Copy size={14} /> Copy diagnostics
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({
  ok,
  icon: Icon,
  label,
  hint,
}: {
  ok: boolean;
  icon: typeof Usb;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <Icon size={16} className={cn("mt-0.5 shrink-0", ok ? "text-success" : "text-warning")} aria-hidden />
      <div className="min-w-0">
        <span className="font-medium">{label}</span>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
