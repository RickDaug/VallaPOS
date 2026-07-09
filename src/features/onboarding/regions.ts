/**
 * Sign-up regions for the US + LATAM launch market. A merchant picks where they
 * sell; that sets the Business `country` (Connect account country + eligible
 * local payment methods) and a sensible default `currency`. Both fields already
 * exist on Business — no migration.
 *
 * Pure module (no server-only / Prisma) so it's shared by the client sign-up
 * form, the "create your business" recovery form, and the server-side
 * createBusiness validation.
 */

export interface Region {
  /** ISO-3166 alpha-2, uppercased — matches Business.country. */
  country: string;
  /** ISO-4217 code stored on Business.currency. */
  currency: string;
  /** Native-language label shown to the merchant. */
  label: string;
  flag: string;
}

export const REGIONS = [
  { country: "US", currency: "USD", label: "United States", flag: "🇺🇸" },
  { country: "MX", currency: "MXN", label: "México", flag: "🇲🇽" },
  { country: "BR", currency: "BRL", label: "Brasil", flag: "🇧🇷" },
  { country: "CA", currency: "CAD", label: "Canada", flag: "🇨🇦" },
] as const satisfies readonly Region[];

export type CountryCode = (typeof REGIONS)[number]["country"];
export type CurrencyCode = (typeof REGIONS)[number]["currency"];

export const DEFAULT_REGION = REGIONS[0]; // United States / USD

/** Country codes as a Zod-friendly non-empty tuple. */
export const COUNTRY_CODES = REGIONS.map((r) => r.country) as [CountryCode, ...CountryCode[]];
/** Currency codes as a Zod-friendly non-empty tuple. */
export const CURRENCY_CODES = REGIONS.map((r) => r.currency) as [CurrencyCode, ...CurrencyCode[]];

/** The region for a country code, or the default when unknown. */
export function regionForCountry(country: string): Region {
  return REGIONS.find((r) => r.country === country) ?? DEFAULT_REGION;
}
