import { z } from "zod";

// Includes MXN + BRL so a Mexican/Brazilian merchant (US+LATAM target market)
// can re-save their currency from Settings, not just at signup.
export const CURRENCIES = ["USD", "MXN", "BRL", "CAD", "EUR", "GBP", "AUD"] as const;

// Curated IANA timezone list covering the US + LATAM target market (plus a few
// common others). The VALUE is a real IANA id passed straight to
// `Intl.DateTimeFormat({ timeZone })` and to the Z-report day-window math, so it
// must stay a valid zone name. Labels are merchant-friendly. Keeping this an
// explicit allow-list (vs. free-form) means every stored timezone is one the
// date math has been reasoned about.
export const TIMEZONE_OPTIONS = [
  { value: "America/New_York", label: "US Eastern — New York" },
  { value: "America/Chicago", label: "US Central — Chicago" },
  { value: "America/Denver", label: "US Mountain — Denver" },
  { value: "America/Phoenix", label: "US Mountain (no DST) — Phoenix" },
  { value: "America/Los_Angeles", label: "US Pacific — Los Angeles" },
  { value: "America/Anchorage", label: "US Alaska — Anchorage" },
  { value: "Pacific/Honolulu", label: "US Hawaii — Honolulu" },
  { value: "America/Toronto", label: "Canada Eastern — Toronto" },
  { value: "America/Mexico_City", label: "Mexico Central — Mexico City" },
  { value: "America/Monterrey", label: "Mexico Central — Monterrey" },
  { value: "America/Cancun", label: "Mexico Southeast — Cancún" },
  { value: "America/Hermosillo", label: "Mexico Northwest (no DST) — Hermosillo" },
  { value: "America/Tijuana", label: "Mexico Pacific — Tijuana" },
  { value: "America/Sao_Paulo", label: "Brazil — São Paulo" },
  { value: "America/Manaus", label: "Brazil — Manaus" },
  { value: "America/Fortaleza", label: "Brazil — Fortaleza" },
  { value: "America/Bogota", label: "Colombia — Bogotá" },
  { value: "America/Lima", label: "Peru — Lima" },
  { value: "America/Buenos_Aires", label: "Argentina — Buenos Aires" },
  { value: "America/Santiago", label: "Chile — Santiago" },
  { value: "Europe/London", label: "UK — London" },
  { value: "Europe/Madrid", label: "Spain — Madrid" },
] as const;

export type TimezoneValue = (typeof TIMEZONE_OPTIONS)[number]["value"];

// A non-empty tuple of the allowed values for `z.enum`. Derived from the option
// list so the two never drift.
export const TIMEZONE_VALUES = TIMEZONE_OPTIONS.map((t) => t.value) as [
  TimezoneValue,
  ...TimezoneValue[],
];

/**
 * Business settings update payload. Extracted from the server action so the
 * validation (currency/tax bounds, the QR-payment transforms + refine) is
 * unit-testable without pulling in `"use server"` / Prisma.
 */
export const updateSettingsSchema = z
  .object({
    businessId: z.string().min(1),
    name: z.string().trim().min(1, "Business name is required").max(80),
    // Tax rate stored as basis points; capped at 100% (10000 bps).
    taxRateBps: z.number().int().min(0).max(10_000),
    currency: z.enum(CURRENCIES),
    // IANA timezone driving report day boundaries + timestamp formatting.
    // Defaults to US Eastern (mirrors the Business.timezone column default).
    timezone: z.enum(TIMEZONE_VALUES).default("America/New_York"),
    taxInclusive: z.boolean(),
    // STORE = instant retail checkout; RESTAURANT unlocks the floor plan + open
    // tabs with per-seat split checks.
    mode: z.enum(["STORE", "RESTAURANT"]),
    // Single-operator "stay unlocked" mode (see Business.singleOperatorMode).
    singleOperatorMode: z.boolean().default(false),
    // Merchant-configured QR payment (confirm-based, no PSP). When enabled the
    // register offers a QR tender that displays qrPayValue (a payment handle or
    // link) for the customer to scan. Value/label are trimmed; empties → null.
    qrPayEnabled: z.boolean().default(false),
    qrPayLabel: z
      .string()
      .trim()
      .max(40)
      .transform((s) => s || null)
      .nullish(),
    qrPayValue: z
      .string()
      .trim()
      .max(512)
      .transform((s) => s || null)
      .nullish(),
  })
  // Can't turn QR on without something to encode.
  .refine((d) => !d.qrPayEnabled || !!d.qrPayValue, {
    message: "Add a QR payment value before enabling QR payments.",
    path: ["qrPayValue"],
  });

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
