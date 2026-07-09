import { z } from "zod";

// Includes MXN + BRL so a Mexican/Brazilian merchant (US+LATAM target market)
// can re-save their currency from Settings, not just at signup.
export const CURRENCIES = ["USD", "MXN", "BRL", "CAD", "EUR", "GBP", "AUD"] as const;

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
