/**
 * Pure helpers for the register's cash-tender numpad (no React/Prisma imports,
 * so they're unit-testable). Values are edited as plain decimal-dollar strings
 * (what the user sees on the keypad); money math elsewhere stays in cents.
 */

/**
 * Apply one numpad key to the current dollar-string value. Keys: "0".."9",
 * "." (decimal), and "back" (delete last char). Enforces a single decimal
 * point and at most two fractional digits, and avoids leading-zero junk
 * ("0" + "5" → "5", not "05"). Returns the next string.
 */
export function applyNumpadKey(value: string, key: string): string {
  if (key === "back") return value.slice(0, -1);

  if (key === ".") {
    if (value.includes(".")) return value; // only one decimal point
    return (value === "" ? "0" : value) + ".";
  }

  if (!/^[0-9]$/.test(key)) return value; // ignore anything unexpected

  const dot = value.indexOf(".");
  if (dot >= 0 && value.length - dot > 2) return value; // already 2 decimals
  if (value === "0") return key; // replace a lone leading zero
  return value + key;
}

/** Parse a dollar-string to integer cents (0 when blank/invalid). */
export function dollarsToCents(value: string): number {
  const n = parseFloat(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

/**
 * Quick cash-tender suggestions (in cents) for a given total: the exact amount,
 * the next whole dollar up, and the standard bills ($5/$10/$20/$50/$100) that
 * are >= the total. Deduped, sorted ascending, capped to a handful so the row
 * stays tappable. Always includes at least the exact total.
 */
export function quickTenderOptions(totalCents: number, limit = 4): number[] {
  if (totalCents <= 0) return [];
  const bills = [500, 1000, 2000, 5000, 10000];
  const nextDollar = Math.ceil(totalCents / 100) * 100;

  const candidates = new Set<number>([totalCents, nextDollar]);
  for (const b of bills) if (b >= totalCents) candidates.add(b);

  return [...candidates].sort((a, b) => a - b).slice(0, limit);
}
