# VallaPOS — Peripheral / Hardware Support (design + roadmap)

> **Status: DESIGN + RESEARCH only.** No app code, no `prisma/schema.prisma`
> change, no new dependency. This is the groundwork a human approves before any
> real device integration is wired — mirroring the convention of
> [`PAYMENTS.md`](./PAYMENTS.md). Today VallaPOS does exactly two
> peripheral-adjacent things: `window.print()` (the browser print dialog, in
> [`src/features/orders/components/ReceiptActions.tsx`](../src/features/orders/components/ReceiptActions.tsx))
> and a **software** cash-drawer reconciliation feature (`src/features/cash-drawer/*`)
> that tracks expected-vs-counted cash but never touches a physical drawer. There
> is **no** physical printer/drawer/scanner control of any kind yet.

Pairs with [`PAYMENTS.md`](./PAYMENTS.md) (the provider/registry/flags convention
this doc mirrors), [`ARCHITECTURE.md`](./ARCHITECTURE.md) (stack, offline, route
handlers for polling endpoints) and [`STATE.md`](../STATE.md).

---

## 0. Scope & target platforms (decisions on record)

These are fixed inputs to the design, not open questions:

- **Target platforms: Android Chrome, desktop Chrome, Windows.** **iOS / Safari is
  deliberately out of scope.** This is load-bearing: Safari ships **none** of
  WebUSB / Web Serial / Web Bluetooth, so dropping it removes the single biggest
  "the browser can't talk to the device" gap. Everything below assumes a
  Chromium engine.
- **Printers in scope: Epson (TM series)** and **Star (TSP / mC-Print / mPOP).**
  Both speak **ESC/POS** (Star in its "Star Line"/StarPRNT dialect, plus an
  ESC/POS emulation mode) — ESC/POS is the common byte protocol we format to.
- **Cash drawer:** there is **no such thing as a standalone "USB cash drawer"** in
  this market. A drawer is a dumb mechanical box that opens when a 24V pulse hits
  its **RJ11/RJ12 kick port**, and that port is driven **by the receipt printer**.
  So **drawer control is a feature of printer control** — if we can talk to the
  printer we can kick the drawer; if we can't, we can't. There is no separate
  drawer transport.
- **Barcode scanner:** the overwhelmingly common case (USB or Bluetooth) is an
  **HID keyboard "wedge"** — the scanner *types* the barcode followed by Enter, as
  if a keyboard did it. That means **scanners already work in VallaPOS today with
  zero integration**: focus an input, scan, the digits appear. We design for that
  reality, not against it.

### The goal vision vs. the hard constraint

The vision: **plug in a printer / drawer / scanner and VallaPOS recognizes it,
auto-configures (model + capabilities), and runs it** — true plug-and-play. The
honest reality is in §1: a **web page can never silently enumerate hardware**, so
"plug it in and it just works with zero clicks" is only fully achievable with a
local bridge or native shell (Phase 3). In a pure browser we get a very close
*second*: **one permission click the first time a given device is seen, then
automatic reconnect + auto-configure forever after**.

---

## 1. The hard constraint (read this before designing anything)

> **A web page cannot silently scan for, enumerate, or auto-connect to hardware it
> has never been granted.** Every one of WebUSB, Web Serial, and Web Bluetooth
> requires a **user gesture** (a click) that opens a **browser-controlled device
> picker** — `navigator.usb.requestDevice()`, `navigator.serial.requestPort()`,
> `navigator.bluetooth.requestDevice()`. The page proposes a *filter* (e.g. "show
> me USB devices with Epson's vendor id"); the **user** picks the device from the
> browser's chooser and grants the origin permission to that **specific** unit.
> The page never gets a free pass to walk the USB/BT bus in the background. This
> is a deliberate anti-fingerprinting / security boundary, not a bug, and there is
> no flag or workaround in a normal browser context.

What this means concretely for "plug-and-play":

1. **First contact is always one click.** The very first time a terminal meets a
   given printer/drawer/scanner, a human must click "Add device" and pick it in
   the OS/browser chooser. We cannot skip this in a pure browser. We make it a
   one-time, well-labeled step in Settings → Devices.
2. **After that it is automatic.** Once granted, the origin can re-acquire the
   device **without another prompt** via `navigator.usb.getDevices()` /
   `navigator.serial.getPorts()` / `navigator.bluetooth.getDevices()` — these
   return the already-approved devices for this origin with **no picker**. We
   call these on app load and reconnect transparently. WebUSB also fires
   `navigator.usb` **`connect` / `disconnect`** events (Web Serial has
   `connect`/`disconnect` on `navigator.serial`; Web Bluetooth has
   `gattserverdisconnected`) so we can auto-reconnect the moment a previously
   approved device is plugged back in or powers up.
3. **Permission is per-origin + per-device + (somewhat) per-profile.** The grant
   is tied to the VallaPOS origin and that physical device. A brand-new printer,
   or the same model on a different terminal, is a *new* device → one more click.
   This is fine for a POS (you provision a terminal once).
4. **True zero-touch (literally plug it in, nothing to click, ever) requires
   leaving the browser sandbox** — a **local bridge agent** (QZ Tray) or a
   **native shell** (Capacitor/TWA/Electron) that has real OS device access. That
   is Phase 3, with the honest cost/licensing tradeoffs stated there.

So the product promise we can truthfully make in a pure browser (Phases 1–2):
**"Add each device once; after that VallaPOS finds it, reconnects, and configures
it automatically."** Not "zero clicks ever" — that needs a bridge/shell.

### The Windows "device claimed by the OS driver" gotcha (verified)

On **Windows**, plugging in a USB receipt printer makes Windows auto-install its
**usbprint.sys** (or a vendor) kernel driver, which **claims the USB interface
exclusively**. When WebUSB then calls `device.open()` / `claimInterface()`, the
OS refuses with a misleadingly-named **`DOMException: Access denied` / "Unable to
claim interface"** — it is not a *file* permission problem, it means *another
kernel driver already owns that interface*. The community workaround is to swap
the driver to the generic **WinUSB** driver (e.g. via **Zadig**), after which
WebUSB can claim it. This is a real provisioning tax on the Windows + WebUSB path
and is a major reason the **network** and **bridge** transports (which don't
fight the OS driver) are more robust on Windows. We surface this in the Devices
UI as a known step and prefer network/bridge for Epson/Star on Windows where the
unit supports it. (Android does **not** have this problem — there's no competing
print driver; WebUSB claims the interface directly. The price on Android is the
opposite — see §3.)

Sources for this section are listed at the bottom.

---

## 2. The `DeviceManager` abstraction

Mirrors the `src/features/payments` shape exactly: **pure types + a provider-like
adapter interface + a registry + a default-OFF feature flag**, with nothing wired
into the live path until approved. Proposed home: `src/features/devices/`.

```
src/features/devices/
  types.ts            # pure types: DeviceKind, Capabilities, transports, jobs
  device-manager.ts   # DeviceManager interface (the uniform surface)
  transports/         # one TransportAdapter per connection mechanism
    webusb.ts
    web-bluetooth.ts
    web-serial.ts
    epson-epos.ts     # network: Epson ePOS-Print over HTTP(S)
    star-webprnt.ts   # network: Star WebPRNT (browser → printer HTTP)
    star-cloudprnt.ts # network: Star CloudPRNT (printer POLLS our server)
    bridge.ts         # local bridge agent (QZ Tray) adapter
  registry.ts         # device registry: vendor:product → model → capabilities
  escpos.ts           # pure ESC/POS byte builder (incl. drawer kick)
  flags.ts            # DEVICES_V1_ENABLED (default OFF)
  index.ts
```

### 2.1 Device kinds & capabilities (`types.ts`)

```ts
type DeviceKind = "receipt-printer" | "cash-drawer" | "barcode-scanner";

interface PrinterCapabilities {
  paperWidthMm: 58 | 80;            // detected/known per model
  dotsPerLine: number;             // 384 (58mm) | 576 (80mm) @ 203dpi typical
  hasAutoCutter: boolean;
  drawerKick: "none" | "rj11";     // can it pulse a drawer kick port?
  drawerPorts: 1 | 2;              // pin 2 / pin 5
  protocol: "escpos" | "starline"; // byte dialect to format
  supportsBarcode: boolean;
  supportsRaster: boolean;         // logo / image printing
}

// A scanner is an HID keyboard in the common case → no capabilities to negotiate.
interface ScannerCapabilities { mode: "hid-keyboard" | "serial" | "usb-raw"; }
```

### 2.2 Transports (the load-bearing abstraction)

A **`TransportAdapter`** hides *how* bytes reach a device. The `DeviceManager`
and the ESC/POS formatter are transport-agnostic — they hand a `Uint8Array` to
`send()`; the adapter delivers it over USB / Bluetooth / serial / network /
bridge.

```ts
type TransportId =
  | "webusb"        // direct USB from the browser (Android great; Windows needs WinUSB)
  | "web-bluetooth" // BT/BLE printers from the browser
  | "web-serial"    // USB/BT serial-emulating devices (desktop Chrome; Android via WebUSB polyfill)
  | "epson-epos"    // network TM printer, Epson ePOS-Print JS SDK over HTTP(S)
  | "star-webprnt"  // network Star printer, browser → printer HTTP
  | "star-cloudprnt"// network Star printer, printer POLLS our HTTPS server (no mixed-content)
  | "bridge";       // local agent (QZ Tray): raw ESC/POS to any OS printer

interface TransportAdapter {
  readonly id: TransportId;
  readonly runtime: ("android" | "desktop-chrome" | "windows")[]; // where it can run
  /** One-time permission grant via the browser picker (no-op for network/bridge/cloudprnt). */
  requestAccess(filter: DeviceFilter): Promise<DeviceHandle>;
  /** Re-acquire already-granted devices with NO prompt (getDevices/getPorts). */
  listGranted(): Promise<DeviceHandle[]>;
  connect(handle: DeviceHandle): Promise<Connection>;
  disconnect(handle: DeviceHandle): Promise<void>;
  /** Auto-reconnect plumbing: connect/disconnect (USB/serial), gattserverdisconnected (BT). */
  onConnectivityChange(cb: (e: ConnectivityEvent) => void): () => void;
}

interface Connection {
  send(bytes: Uint8Array): Promise<void>;   // raw ESC/POS / StarLine bytes
  readStatus?(): Promise<DeviceStatus>;     // paper out, cover open, drawer state (where supported)
}
```

The two **network** Star transports differ in direction and that difference is the
whole reason CloudPRNT exists (see §5):

- `star-webprnt` / `epson-epos`: **browser → printer** over the LAN. Subject to
  the **HTTPS→HTTP mixed-content** wall (VallaPOS is HTTPS; the printer's LAN
  endpoint is plain HTTP).
- `star-cloudprnt`: **printer → our server**. The printer **polls** an HTTPS
  endpoint we host for jobs. No browser→printer call, so **no mixed-content
  problem** and **no SSL cert to install on the printer**. This is the most
  robust path for an HTTPS web POS (see §5).

### 2.3 The `DeviceManager` interface (uniform surface)

```ts
interface DeviceManager {
  /** First-contact: open the browser picker for a kind; persists the grant. (One click.) */
  addDevice(kind: DeviceKind, hint?: ModelHint): Promise<RegisteredDevice>;
  /** App-load: silently re-acquire previously granted devices (getDevices) + reconnect. */
  restore(): Promise<RegisteredDevice[]>;
  list(): RegisteredDevice[];
  getDefault(kind: DeviceKind): RegisteredDevice | undefined;
  setDefault(kind: DeviceKind, deviceId: string): void;

  printReceipt(deviceId: string, doc: ReceiptDoc): Promise<PrintResult>;
  kickDrawer(deviceId: string, port?: 1 | 2): Promise<DrawerResult>; // rides the printer
  testPrint(deviceId: string): Promise<PrintResult>;                 // "Test" button in Settings
  probe(deviceId: string): Promise<DeviceStatus>;                    // paper/cover/online
}
```

`RegisteredDevice` = `{ id, kind, transportId, vendorId, productId, model,
capabilities, label, persistedRef }`. `persistedRef` is the small non-secret
handle we store to re-find the device after reload (see §6.5).

### 2.4 The device registry (vendor:product → model → capabilities)

A **pure lookup table** (no I/O, unit-testable, exactly like
`payments/registry.ts`). Once a transport gives us the device's USB **vendor id +
product id** (WebUSB exposes `device.vendorId` / `device.productId`; network
transports report model strings via the ePOS/WebPRNT/CloudPRNT status response),
we map to a known model and its capabilities — **this is the "auto-configure"
half of plug-and-play**:

```ts
// Illustrative — exact PIDs to be filled from Epson/Star USB descriptors at build time.
const DEVICE_REGISTRY = {
  "04b8": {                       // Epson vendor id (0x04B8)
    vendorName: "Epson",
    products: {
      // TM-m30II family, TM-T88VI, TM-m50, ... → paper width, cutter, drawer kick
      "<pid>": { model: "TM-m30II", paperWidthMm: 80, hasAutoCutter: true,
                 drawerKick: "rj11", drawerPorts: 2, protocol: "escpos" },
    },
  },
  "0519": {                       // Star Micronics vendor id (0x0519)
    vendorName: "Star",
    products: {
      "<pid>": { model: "TSP143IV", paperWidthMm: 80, hasAutoCutter: true,
                 drawerKick: "rj11", drawerPorts: 2, protocol: "starline" },
      "<pid>": { model: "mC-Print3", paperWidthMm: 80, hasAutoCutter: true, drawerKick: "rj11" },
      "<pid>": { model: "mPOP",      paperWidthMm: 58, hasAutoCutter: true, drawerKick: "rj11" },
    },
  },
} as const;
```

**Capability auto-detection** has two layers:
1. **Static** (the registry): vendor:product → known model → known caps. Covers
   the listed Epson/Star units instantly and offline.
2. **Dynamic** (runtime probe): for network printers, the ePOS / WebPRNT /
   CloudPRNT **status response** reports model, online state, paper-out,
   cover-open, and drawer state. For an **unknown** USB unit we fall back to a
   safe default profile (80mm, ESC/POS, assume cutter+drawer) and let the user
   confirm/override in Settings → Devices. This keeps "plug it in and it
   configures itself" true for known models and *graceful* for unknown ones.

### 2.5 Connect / reconnect lifecycle

```
addDevice(kind)                    # ONE user click → browser picker → grant persisted
  → registry lookup (vid:pid)      # auto-configure capabilities
  → connect() → testPrint()        # confirm it works

App load / route mount:
  restore()                        # getDevices()/getPorts() → NO prompt
    → for each granted handle: registry lookup → connect()
  onConnectivityChange:
    'connect'  (USB replugged / BT back) → reconnect silently, toast "Printer reconnected"
    'disconnect'                         → mark offline, toast, fall back to window.print()
```

The fallback is important: **if no device is connected, the register/receipt flow
degrades to today's `window.print()`** so VallaPOS never *worse* than it is now.

### 2.6 The flag (`DEVICES_V1_ENABLED`, default OFF)

Same pattern as `PAYMENTS_V2_ENABLED`: a pure `flags.ts` reading `process.env`
directly (no `server-only`), default OFF. While off, `ReceiptActions` keeps using
`window.print()` unchanged. Promote to the zod schema in `@/lib/env.ts` when it
graduates from groundwork.

---

## 3. Concrete model → transport recommendations

Two common units, on our two target runtimes. (Both are 80mm desktop receipt
printers with auto-cutter and an RJ11 drawer-kick port.)

### Star **TSP143IV** (dual USB-C/USB-A **+ Ethernet LAN**, CloudPRNT + WebPRNT standard)

| Runtime | Recommended transport | Why / caveat |
|---|---|---|
| **Windows** | **CloudPRNT** (LAN) → fallback WebUSB | CloudPRNT sidesteps both the mixed-content wall *and* the WinUSB driver-claim gotcha; printer polls our HTTPS server. If LAN isn't available, WebUSB works but needs the **WinUSB/Zadig** driver swap. |
| **Android Chrome** | **CloudPRNT** (LAN/Wi-Fi) → fallback WebUSB | CloudPRNT is cleanest. WebUSB also works well on Android (no driver fight) but Android USB-host + power for a desktop printer is awkward; the TSP143IV also has **AOA** (Android Open Accessory) for USB. |
| Either | WebPRNT only if you can solve mixed-content | Works browser→printer but you must give the printer an HTTPS cert or proxy it. CloudPRNT is strictly easier here. |

**Recommendation: lead with CloudPRNT for the TSP143IV** — it's the path with the
fewest moving parts for an HTTPS web POS.

### Epson **TM-m30II** (USB + optional Ethernet/Wi-Fi, ePOS-Print)

| Runtime | Recommended transport | Why / caveat |
|---|---|---|
| **Windows** | **ePOS-Print over the network** (if the Ethernet/Wi-Fi model) → fallback WebUSB | ePOS-Print talks to the TM's built-in HTTP server. **Mixed-content caveat:** our HTTPS page calling the printer's HTTP endpoint is blocked → enable the printer's **HTTPS/self-signed** endpoint or use **Epson Server Direct Print**. USB path needs WinUSB/Zadig. |
| **Android Chrome** | **ePOS-Print over the network** → fallback WebUSB | Same ePOS-Print SDK (`epos-2.js`); WebUSB also viable on Android (no driver fight). Mixed-content caveat identical. |
| USB-only TM-m30II | **WebUSB** (Android) / **WebUSB+WinUSB** (Windows) or a **bridge** | No network endpoint → must use direct USB or a local bridge. |

**Recommendation:** for a **networked** TM-m30II, ePOS-Print is the native path
but you must resolve mixed-content (printer HTTPS or Server Direct Print). For a
**USB-only** TM, WebUSB on Android is the cleanest; on Windows the WinUSB swap or
a bridge (Phase 3) is smoother than fighting the driver.

### Cross-cutting recommendation

- **Prefer networked printers + a network transport** (CloudPRNT for Star,
  ePOS/Server-Direct-Print for Epson) as the primary path. They dodge both the
  Windows driver-claim gotcha and the per-device USB permission friction, and are
  the same on Android and Windows.
- **Use WebUSB as the no-network fallback**, best on Android, requiring a WinUSB
  driver swap on Windows.
- **Barcode scanner:** buy/keep an **HID-keyboard-mode** USB or BT scanner →
  zero integration, works today. Only consider serial/USB-raw scanner modes if a
  business needs scan events without a focused input (a Phase 2+ nicety).

---

## 4. VallaPOS integration points

### 4.1 Settings → "Devices" screen (new)

A new `src/features/devices/` UI under Settings (MANAGER+ to configure, like Floor
plan), per the existing Settings convention:

- **Add device** (per kind): one button → browser picker → registry
  auto-configure → shows detected model + capabilities. The one permitted "one
  click" of §1.
- **Per-device card:** label, model, transport, online/offline dot, paper width,
  cutter/drawer flags, **"Test print"** and **"Open drawer"** buttons, "Set as
  default", remove.
- **Auto-reconnect status:** "Reconnects automatically — added on this device."
  Surfaces the Windows WinUSB note inline when WebUSB is the chosen transport and
  the platform is Windows.
- **Persistence:** per device, per business, per terminal (§6.5).

### 4.2 Wire the drawer-kick to cash checkout

This is the highest-value first behavior and ties into the **existing** software
cash-drawer feature:

- On a successful **cash** (and optionally manual/QR-with-change) checkout in
  `src/features/register/actions.ts` → after the receipt prints, the client calls
  `deviceManager.kickDrawer(defaultPrinterId)`. The kick **rides the printer's
  RJ11 port** via the ESC/POS pulse command (§4.4) — there is no separate drawer
  device.
- Gate it on a per-business setting ("Open drawer on cash sale") and on a default
  printer being present. **No printer / no device → no-op** (today's behavior).
- This complements — does **not** replace — the software reconciliation in
  `src/features/cash-drawer/*`. The physical kick opens the box; the existing
  blind-count close still reconciles expected vs counted. They're orthogonal and
  both useful.

### 4.3 Receipt → ESC/POS formatter

A pure `escpos.ts` (no `server-only`, fully unit-testable like `money.ts`) that
takes the **same `ReceiptDoc`** the receipt page already renders (business
header, line items + modifiers, per-line tax, totals, tender/change, footer) and
emits a `Uint8Array` of ESC/POS bytes: init, alignment, double-height for the
header/total, the item table padded to the paper width (`58 → 32 cols`,
`80 → 48 cols` at Font A), optional logo raster, the **cut** command, and the
**drawer kick**. For Star units we either emit ESC/POS-emulation bytes or the
StarLine dialect based on `capabilities.protocol`. The formatter is shared by
every transport — USB, BT, serial, ePOS, WebPRNT, CloudPRNT all send the same
bytes (CloudPRNT/WebPRNT wrap them per their job format).

> Reuse note: the existing printable receipt component and its `ReceiptDoc`-shaped
> data are the source of truth; the ESC/POS formatter is a second *renderer* of
> the same data, exactly like the email receipt renderer added in #60. Don't fork
> the receipt model.

### 4.4 The ESC/POS drawer-kick command (verified)

The drawer kick is the standard ESC/POS **`ESC p m t1 t2`** pulse
(`1B 70 <m> <t1> <t2>`), where `m` selects the connector pin (`0x00` = pin 2,
`0x01` = pin 5) and `t1`/`t2` set the on/off pulse width. Common safe values:
`1B 70 00 19 FA` (pin 2, ~50ms/200ms) or `1B 70 00 32 32` (balanced 100ms/100ms).
Epson's `epos-2.js` exposes this as **`builder.addPulse(drawer, time)`** (drawer
= pin, time = pulse length) — verified against Epson's ePOS SDK reference. **Do
not pulse the drawer repeatedly in a tight loop** — Epson's docs explicitly warn
this can damage the drawer's solenoid from excessive load. Star units take the
equivalent kick in their job stream.

### 4.5 Barcode scanner (already works — keep it that way)

Because the common scanner is an **HID keyboard wedge**, the register's existing
search/SKU input *already* receives scans today. The only "integration" worth
doing: ensure a register field is focus-targeted for scanning, and (Phase 1
polish) add a global keystroke listener that recognizes the fast,
Enter-terminated burst pattern of a scanner vs. human typing, so a scan rings up
an item even when no input is focused. **No WebUSB/HID-API permission is needed
for the keyboard-wedge case** — that's the whole point. (A true Web HID / serial
scanner integration, for non-keyboard scanners, is an optional later add and
*does* need the one-time `requestDevice()` grant.)

---

## 5. The HTTPS → HTTP mixed-content problem (verified, important)

VallaPOS is served over **HTTPS**. Epson ePOS-Print and Star WebPRNT default to
the printer exposing a **plain-HTTP** endpoint on the LAN (e.g.
`http://192.168.1.50/`). A browser **blocks** an HTTPS page from issuing
requests to an HTTP endpoint as **mixed content** — so a naive
"HTTPS web POS → printer HTTP API" call **fails**. This is the single biggest
foot-gun of the network-printer path and there are three honest ways around it,
in increasing order of robustness:

1. **Give the printer an HTTPS endpoint.** Both Epson TM and Star support
   HTTPS/SSL on the device. The catch is a **self-signed certificate** the
   browser won't trust → the operator must accept it once per terminal, and certs
   expire/rotate. Workable but fiddly.
2. **Epson Server Direct Print** (Epson) — the printer **pulls** print jobs from a
   server endpoint we host instead of the browser pushing to the printer. No
   browser→printer call, so no mixed-content. This is Epson's analog of CloudPRNT.
3. **Star CloudPRNT** (Star) — **the printer polls our HTTPS server** for jobs via
   a REST/JSON `POST` at a fixed interval; the server replies with the ESC/POS
   payload. **There is no browser→printer request at all**, so **mixed-content
   never arises**, and — verified — **no SSL certificate needs to be installed or
   maintained on the printer** (the printer is the HTTPS *client*). It also needs
   **no firewall / port-forward / tunnel** because the printer makes the outbound
   connection.

**Conclusion: for an HTTPS web POS, the printer-polls-the-server model
(CloudPRNT / Server Direct Print) is the most robust network path** and is the
recommended Phase 2 target. WebPRNT/ePOS-direct are only worth it when you can
cleanly solve the printer-HTTPS cert. CloudPRNT does mean VallaPOS hosts a small
polling route handler (`app/api/devices/cloudprnt/[businessId]/route.ts`) — a
natural fit for the existing Next.js route-handler convention used for webhooks.

---

## 6. Phased roadmap (with rough effort + honest tradeoffs)

All phases ship behind `DEVICES_V1_ENABLED` (default OFF) and never regress the
`window.print()` fallback. Mirrors the PAYMENTS sequencing discipline.

### Phase 1 — Pure-browser direct (WebUSB) + free scanner — *small-to-medium*

**Goal:** plug an Epson/Star USB printer into an **Android** terminal, add it once,
and print ESC/POS receipts + kick the drawer on cash checkout. Plus formalize the
already-working HID scanner.

- `escpos.ts` formatter (pure, tested) + `webusb.ts` transport + the registry for
  the listed Epson/Star PIDs + `device-manager.ts` + the Settings → Devices UI +
  `kickDrawer` wired to cash checkout (§4.2) + the global scanner-burst listener.
- **Effort:** ~1–2 weeks. Most cost is the ESC/POS formatter + the
  add/reconnect/test UX, not the transport.
- **Tradeoffs / honest caveats:**
  - **Android: great.** Direct WebUSB claim, no driver fight.
  - **Windows: needs the WinUSB/Zadig driver swap** per terminal (§1 gotcha) — a
    real provisioning step. Document it; consider deferring Windows-USB to the
    network path (Phase 2) or the bridge (Phase 3).
  - Still **one click to add** each device (the §1 constraint). Scanner is free
    (HID keyboard) — **zero** cost/click.
  - No new paid dependency; no schema change if we persist device handles in
    `localStorage`/IndexedDB per terminal (§6.5). A per-business "open drawer on
    cash sale" toggle is a tiny additive setting (own migration branch if stored
    server-side).

### Phase 2 — Network printers (CloudPRNT / ePOS) + capability auto-detect — *medium*

**Goal:** the robust, Windows-friendly, mixed-content-proof path; full
auto-configure from the model registry + live status.

- `star-cloudprnt.ts` (printer polls our HTTPS route handler) + `epson-epos.ts` /
  Server Direct Print + the CloudPRNT polling route under `app/api/devices/...` +
  dynamic capability/status probe (paper-out, cover-open, drawer state) feeding
  the registry + Devices UI online/offline + offline-queue awareness (a queued
  print retries when the printer reconnects, like the offline sales queue).
- **Effort:** ~2–3 weeks. The polling route + job lifecycle + status reconciliation
  is the bulk.
- **Tradeoffs / honest caveats:**
  - **CloudPRNT is the cleanest:** no mixed-content, no printer SSL cert, no
    firewall/port-forward, identical on Android + Windows, no WinUSB swap. Cost is
    that **VallaPOS must host + maintain the polling endpoint** and printers must
    be **networked** models (TSP143IV yes; USB-only units can't use it).
  - **ePOS/WebPRNT-direct still hit mixed-content** → require printer HTTPS
    (self-signed, must be accepted/rotated per terminal) or Server Direct Print.
    Prefer CloudPRNT for Star; prefer Server Direct Print over ePOS-direct for
    Epson when networked.
  - No paid SDK license for either (Epson `epos-2.js` and Star CloudPRNT/WebPRNT
    SDKs are free vendor SDKs). Pin them exactly + commit the lockfile per the
    dependency rule.

### Phase 3 — Local bridge and/or native shell (true zero-touch) — *medium-to-large, has cost/licensing*

**Goal:** the actual "plug it in, nothing to click, ever" vision, and clean
Windows-USB + cross-brand support.

- **Option A — local bridge (QZ Tray):** a small signed agent the merchant
  installs on the **Windows/desktop** terminal. The web app talks to it over a
  local websocket; it does **true OS-level auto-detect of installed printers**,
  raw ESC/POS, drawer kick, and cross-brand support **without** any browser
  picker and **without** the WinUSB swap.
  - **Honest tradeoffs:** **Desktop only — QZ Tray does NOT run on Android**
    (verified). It's an **install** (provisioning friction). **Licensing
    (verified):** QZ Tray is open-source under **LGPL** and free to self-host, but
    production use without your own code-signing certificate pops a trust dialog;
    QZ sells a **paid commercial/"trusted" support + signing** offering. State
    this honestly to the merchant: free-but-self-signed vs paid-trusted. Adds an
    external runtime dependency we don't control.
- **Option B — native shell (Capacitor / Android TWA / Electron):**
  - **Capacitor / TWA (Android):** wrap the PWA; a native USB/Bluetooth plugin
    gives **real Android USB auto-detect** (no WebUSB picker) and survives where
    the browser sandbox can't. This is also the shell the **payments** roadmap
    already needs for Tap-to-Pay (see `PAYMENTS.md` `requiresNativeShell`) — the
    two roadmaps **share this dependency**, so doing it once serves both.
  - **Electron (Windows desktop):** real OS printer + serial access, no WinUSB
    swap, but a heavier desktop install.
  - **Honest tradeoffs:** a native shell is the **biggest** lift (app-store/MSIX
    packaging, update channel, native plugin maintenance) and is a strategic
    decision shared with payments — **don't build it for printers alone**; build
    it when payments forces it and get device auto-detect for free.

**Phasing logic:** Phase 1 proves value on Android with zero spend. Phase 2 makes
it robust + Windows-friendly + truly auto-configuring with still-zero spend
(just hosting a polling route). Phase 3 buys true zero-touch and clean
Windows-USB, but only justifies its install/licensing cost when paired with the
native-shell decision the payments roadmap already owns.

---

## 7. Summary

- **The constraint:** a browser can't silently enumerate hardware — every USB/BT/
  serial device needs **one user click** through a browser picker the first time
  (`requestDevice`/`requestPort`), then **auto-reconnects with no prompt**
  (`getDevices`/`getPorts` + connect/disconnect events). True zero-touch needs a
  **bridge (QZ Tray) or native shell**. iOS/Safari being out of scope removes the
  "no WebUSB at all" gap.
- **The architecture:** a `DeviceManager` + per-mechanism `TransportAdapter`s
  (WebUSB / Web Bluetooth / Web Serial / Epson-ePOS / Star-WebPRNT / Star-CloudPRNT
  / bridge) + a **pure device registry** (Epson `0x04B8` / Star `0x0519`
  vendor:product → model → capabilities) + a pure **ESC/POS formatter** (the
  common protocol, incl. `ESC p` drawer kick) + a default-OFF `DEVICES_V1_ENABLED`
  flag — **mirroring `src/features/payments`** exactly.
- **Drawer & scanner reality:** the **cash drawer rides the printer's RJ11 kick
  port** (no standalone drawer transport); most **barcode scanners are HID
  keyboards** and **already work today** with zero integration.
- **Phasing:** P1 browser WebUSB (Android-first) + free scanner; P2 network
  **CloudPRNT/ePOS** for robustness + auto-detect; P3 bridge/native shell for true
  zero-touch (cost/licensing/install tradeoffs, shared with the payments native
  shell).

### The 3 most important honest caveats (verified)

1. **No silent hardware discovery — ever — in a pure browser.** Every new device
   is one mandatory user-gesture permission click; "plug-and-play with zero
   clicks" is only true with a bridge/native shell. The realistic browser promise
   is "add once, auto-reconnect + auto-configure after."
2. **Windows + WebUSB fights the OS print driver.** Windows auto-claims the
   printer's USB interface (usbprint.sys), so `claimInterface()` throws "Access
   denied" until the driver is swapped to **WinUSB** (Zadig) — a real
   per-terminal provisioning tax. Android has no such problem. This is why the
   **network/CloudPRNT** path is preferred on Windows.
3. **HTTPS→HTTP mixed content blocks browser→printer LAN calls.** An HTTPS POS
   can't call a printer's plain-HTTP ePOS/WebPRNT endpoint. The robust fix is the
   **printer-polls-the-server** model — **Star CloudPRNT** (and Epson **Server
   Direct Print**): no mixed content, **no printer SSL cert**, no firewall/port
   work. This makes CloudPRNT the recommended network transport.

---

## 8. Sources

Browser device APIs & the permission model:
- Chrome — Connect a website to a USB/Serial/HID device: https://support.google.com/chrome/answer/12576972
- WebUSB browser support (Can I Use): https://caniuse.com/webusb
- Read from / write to a serial port (Web Serial, incl. Android-via-WebUSB-polyfill note): https://developer.chrome.com/docs/capabilities/serial
- Intent to Ship: Web serial over Bluetooth on Android: https://groups.google.com/a/chromium.org/g/blink-dev/c/BqUGCcurReE

Windows WinUSB / interface-claim gotcha:
- WICG/webusb #199 — Driver support in Windows: https://github.com/WICG/webusb/issues/199
- WICG/webusb #184 — Access Denied in device.open: https://github.com/WICG/webusb/issues/184

Epson ePOS-Print / drawer kick:
- Epson ePOS SDK for JavaScript — addPulse (drawer kick): https://download4.epson.biz/sec_pubs/pos/reference_en/epos_js/ref_epos_sdk_js_en_printerobject_addpulsemethod.html
- Epson ePOS-Print API User's Manual (Server Direct Print, HTTP): https://files.support.epson.com/pdf/pos/bulk/tm-i_epos-print_um_en_revk.pdf

Star WebPRNT vs CloudPRNT:
- Star — WebPRNT vs CloudPRNT comparison (cert/firewall, polling): https://starmicronics.com/blog/webprnt-cloudprnt-comparison/
- Star CloudPRNT Developer Guide (printer polls server, REST/JSON): https://www.starmicronics.com/support/Mannualfolder/IFBD-HI01X_CloudPRNT_for_Developer.pdf
- Star TSP143IV (CloudPRNT standard, USB-C/LAN, AOA): https://starmicronics.com/product/tsp143iv-thermal-receipt-printer/

QZ Tray (bridge) — capabilities, platforms, licensing:
- QZ Tray — what is raw printing (ESC/POS, drawer kick): https://qz.io/docs/what-is-raw-printing
- QZ Tray (LGPL, cross-platform desktop — Win/Mac/Linux): https://qz.io/

ESC/POS drawer-kick command:
- ESC/POS drawer kick `ESC p`/hex pulse values: https://help.catchfood.com/knowledgebase/articles/esc-pos-hex-command
