/**
 * PURE parsing + validation for bulk catalog entry (paste-or-type grid).
 *
 * Shared by the client grid (live preview / per-row error hints) AND the server
 * action (authoritative re-validation — the client is never trusted). No DB, no
 * React, no `server-only`, so `bulk-parse.test.ts` covers the fiddly bits:
 * spreadsheet paste, money parsing across US/EU/LATAM formats, and the
 * one-cell multi-size syntax.
 */

export type CatalogPreset = "menu" | "retail" | "service";
export type ItemType = "PRODUCT" | "SERVICE";

/** Which editable column a grid cell maps to. */
export type ColumnKey = "name" | "price" | "category" | "sku" | "type";

export interface PresetConfig {
  key: CatalogPreset;
  label: string;
  /** Columns shown, in order — also the default paste column mapping. */
  columns: ColumnKey[];
  /** Header shown for the category column (e.g. "Section" for a menu). */
  categoryLabel: string;
  /** Default item type when the row has no explicit type cell/value. */
  defaultType: ItemType;
}

export const PRESETS: Record<CatalogPreset, PresetConfig> = {
  menu: {
    key: "menu",
    label: "Menu",
    columns: ["name", "price", "category"],
    categoryLabel: "Section",
    defaultType: "PRODUCT",
  },
  retail: {
    key: "retail",
    label: "Retail",
    columns: ["name", "price", "category", "sku"],
    categoryLabel: "Category",
    defaultType: "PRODUCT",
  },
  service: {
    key: "service",
    label: "Services",
    columns: ["name", "price", "category"],
    categoryLabel: "Category",
    defaultType: "SERVICE",
  },
};

export function getPreset(preset: string): PresetConfig {
  return PRESETS[preset as CatalogPreset] ?? PRESETS.retail;
}

/** A raw, unvalidated grid row — plain strings straight from the cells. */
export interface RawRow {
  name?: string;
  price?: string;
  category?: string;
  sku?: string;
  type?: string;
}

export interface ParsedVariation {
  name: string;
  priceCents: number;
}

export interface ParsedRow {
  name: string;
  type: ItemType;
  categoryName: string | null;
  sku: string | null;
  variations: ParsedVariation[];
}

export type RowResult = { ok: true; row: ParsedRow } | { ok: false; error: string };

const NAME_MAX = 80;
const CATEGORY_MAX = 60;
const SKU_MAX = 60;
const PRICE_MAX_CENTS = 10_000_000; // $100,000.00 — mirrors the single-item schema

/**
 * Parse a human-typed money string to integer cents, tolerantly, across the
 * formats a US/MX/BR merchant might paste:
 *   "9.99", "$9.99", "1,234.56", "9,99" (EU/LATAM decimal comma), "  12 ", "0".
 * Returns null when it isn't a parseable non-negative amount.
 */
export function parseMoneyToCents(input: string): number | null {
  let s = input.trim();
  if (s === "") return null;
  // Strip currency symbols, spaces, and letters; keep digits, separators, sign.
  s = s.replace(/[^\d.,-]/g, "");
  if (s === "" || s === "-") return null;
  if (s.includes("-")) return null; // no negative prices

  const hasDot = s.includes(".");
  const hasComma = s.includes(",");

  if (hasDot && hasComma) {
    // The LAST separator is the decimal; the other is a thousands separator.
    const decimalSep = s.lastIndexOf(".") > s.lastIndexOf(",") ? "." : ",";
    const thousandsSep = decimalSep === "." ? "," : ".";
    s = s.split(thousandsSep).join("");
    if (decimalSep === ",") s = s.replace(",", ".");
  } else if (hasComma) {
    // Only commas. If it looks like a decimal comma (exactly 1-2 trailing
    // digits, one comma), treat as decimal; otherwise commas are thousands.
    const parts = s.split(",");
    const last = parts[parts.length - 1]!;
    if (parts.length === 2 && last.length > 0 && last.length <= 2) {
      s = parts[0] + "." + last;
    } else {
      s = parts.join("");
    }
  } else if (hasDot) {
    // Only dots. Symmetric to the comma rule so LATAM dot-grouping parses right:
    // a single dot with exactly 1-2 trailing digits is a decimal point ("9.99"),
    // so it's left as-is; ANY other dot use is a thousands grouping to strip
    // ("1.234" → 1234, "1.234.567" → 1234567). Without this, "1.234" wrongly
    // parsed as 1.234 (≈$1.23) instead of $1,234.00.
    const parts = s.split(".");
    const last = parts[parts.length - 1]!;
    if (!(parts.length === 2 && last.length > 0 && last.length <= 2)) {
      s = parts.join("");
    }
  }
  // else: no separators — already a valid integer form.

  const value = Number(s);
  if (!Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  if (cents > PRICE_MAX_CENTS) return null;
  return cents;
}

/**
 * Parse a price cell into one or more variations.
 *  - "9.99"                      → [{ Default, 999 }]
 *  - "Small:2.50, Large:3.50"    → [{ Small, 250 }, { Large, 350 }]  (also `;`)
 * A size with a bad/blank price fails the whole cell (no silent drop).
 */
export function parsePriceCell(cell: string): { ok: true; variations: ParsedVariation[] } | { ok: false; error: string } {
  const text = cell.trim();
  if (text === "") return { ok: false, error: "Price is required" };

  if (text.includes(":")) {
    const parts = text.split(/[,;]/).map((p) => p.trim()).filter((p) => p.length > 0);
    if (parts.length === 0) return { ok: false, error: "Invalid sizes" };
    const variations: ParsedVariation[] = [];
    const seen = new Set<string>();
    for (const part of parts) {
      const idx = part.indexOf(":");
      const name = part.slice(0, idx).trim();
      const priceStr = part.slice(idx + 1).trim();
      if (!name) return { ok: false, error: "Size is missing a name" };
      if (name.length > CATEGORY_MAX) return { ok: false, error: `Size name too long: "${name}"` };
      const key = name.toLowerCase();
      if (seen.has(key)) return { ok: false, error: `Duplicate size "${name}"` };
      seen.add(key);
      const cents = parseMoneyToCents(priceStr);
      if (cents === null) return { ok: false, error: `Bad price for size "${name}"` };
      variations.push({ name, priceCents: cents });
    }
    return { ok: true, variations };
  }

  const cents = parseMoneyToCents(text);
  if (cents === null) return { ok: false, error: `Not a valid price: "${text}"` };
  return { ok: true, variations: [{ name: "Default", priceCents: cents }] };
}

/** Normalize a free-typed type cell to PRODUCT/SERVICE, or null if unrecognized. */
export function parseType(input: string | undefined, fallback: ItemType): ItemType | null {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "") return fallback;
  if (/^(product|prod|p|good|retail|item)$/.test(s)) return "PRODUCT";
  if (/^(service|serv|svc|s)$/.test(s)) return "SERVICE";
  return null;
}

/** True when every cell is blank — a blank row is skipped, not an error. */
export function isBlankRow(raw: RawRow): boolean {
  return !(
    (raw.name && raw.name.trim()) ||
    (raw.price && raw.price.trim()) ||
    (raw.category && raw.category.trim()) ||
    (raw.sku && raw.sku.trim()) ||
    (raw.type && raw.type.trim())
  );
}

/**
 * Validate one raw row against a preset. Returns a ParsedRow or a single
 * human-readable error (first problem found). Blank rows must be filtered by the
 * caller with `isBlankRow` first (they're neither valid nor an error).
 */
export function validateRow(raw: RawRow, preset: PresetConfig): RowResult {
  const name = (raw.name ?? "").trim();
  if (!name) return { ok: false, error: "Name is required" };
  if (name.length > NAME_MAX) return { ok: false, error: `Name is too long (max ${NAME_MAX})` };

  const price = parsePriceCell(raw.price ?? "");
  if (!price.ok) return { ok: false, error: price.error };

  const type = parseType(raw.type, preset.defaultType);
  if (type === null) return { ok: false, error: `Type must be Product or Service (got "${raw.type}")` };

  const categoryRaw = (raw.category ?? "").trim();
  if (categoryRaw.length > CATEGORY_MAX) return { ok: false, error: `Category is too long (max ${CATEGORY_MAX})` };
  const categoryName = categoryRaw.length > 0 ? categoryRaw : null;

  // SKU only applies to presets that show it (retail); ignore otherwise.
  let sku: string | null = null;
  if (preset.columns.includes("sku")) {
    const skuRaw = (raw.sku ?? "").trim();
    if (skuRaw.length > SKU_MAX) return { ok: false, error: `SKU is too long (max ${SKU_MAX})` };
    sku = skuRaw.length > 0 ? skuRaw : null;
  }

  return { ok: true, row: { name, type, categoryName, sku, variations: price.variations } };
}

/**
 * Split pasted clipboard text (Excel/Sheets = tab-separated; CSV = comma) into
 * raw rows, mapping columns by the preset's visible order. Tab wins when present
 * on a line; otherwise comma. Fully blank lines are dropped. Quoted CSV fields
 * with embedded separators are NOT handled (rare for catalog paste) — a simple,
 * predictable split beats a fragile half-CSV parser.
 */
export interface ParsedModifierOption {
  name: string;
  priceDeltaCents: number;
}

export interface ModifierParseResult {
  options: ParsedModifierOption[];
  errors: { line: number; message: string }[];
}

/**
 * Parse a multi-line modifier box into options — one per line, replacing the
 * one-at-a-time / blank-row entry. Accepted per line:
 *   "Oat milk +0.75"   "Oat milk 0.75"   "Extra shot: 1.00"   "Oat milk\t0.75"
 *   "Whole milk"       → free (0)
 * A line whose trailing token looks like money is split into name + price;
 * otherwise the whole line is the name at +0. A malformed price is reported (not
 * silently zeroed). Blank lines are skipped. Duplicate names (case-insensitive)
 * are flagged.
 */
export function parseModifierLines(text: string): ModifierParseResult {
  const options: ParsedModifierOption[] = [];
  const errors: { line: number; message: string }[] = [];
  const seen = new Set<string>();

  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  lines.forEach((rawLine, i) => {
    const lineNo = i + 1;
    const line = rawLine.trim();
    if (line === "") return;

    let name = line;
    let priceStr = "";
    if (line.includes("\t")) {
      const [n, p = ""] = line.split("\t");
      name = n!.trim();
      priceStr = p.trim();
    } else {
      // A trailing token is taken as the price ONLY when it clearly looks like
      // one: it starts with + / $ ("+0.75", "$2" — "I meant a price", so "Cheese
      // +abc" is caught as a BAD price rather than silently becoming a name), OR
      // it's a number carrying a decimal separator ("0.75", "1,50"). A BARE
      // integer is NOT a price, so a name like "Combo 2" keeps its trailing
      // number instead of being mis-split into "Combo" +$2 (audit R4 #3).
      const m = line.match(/^(.+?)[\s:]+([+$]\S*|\d*[.,]\d+)$/);
      if (m) {
        name = m[1]!.trim();
        priceStr = m[2]!.trim();
      }
    }

    if (!name) {
      errors.push({ line: lineNo, message: "Missing modifier name" });
      return;
    }
    if (name.length > 60) {
      errors.push({ line: lineNo, message: `Name too long: "${name}"` });
      return;
    }

    let priceDeltaCents = 0;
    if (priceStr !== "") {
      const cents = parseMoneyToCents(priceStr);
      if (cents === null) {
        errors.push({ line: lineNo, message: `Bad price on "${name}"` });
        return;
      }
      priceDeltaCents = cents;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      errors.push({ line: lineNo, message: `Duplicate "${name}"` });
      return;
    }
    seen.add(key);
    options.push({ name, priceDeltaCents });
  });

  return { options, errors };
}

/** "Extra " is the longest prefix we prepend; keep the pair ≤ the 60-char cap. */
const INGREDIENT_NAME_MAX = 54;

/**
 * Expand an ingredient list into "No ___" (free) + "Extra ___" (+upcharge)
 * modifier options. Each line is `Ingredient` or `Ingredient +price` (the price
 * is the EXTRA upcharge; no price = the extra is free too). Reuses
 * `parseModifierLines` for the line parsing (so money formats + dup detection +
 * blank-skipping are shared), then produces two options per ingredient.
 */
export function buildIngredientOptions(text: string): ModifierParseResult {
  const parsed = parseModifierLines(text);
  const options: ParsedModifierOption[] = [];
  const errors = [...parsed.errors];
  for (const ing of parsed.options) {
    if (ing.name.length > INGREDIENT_NAME_MAX) {
      errors.push({ line: 0, message: `Ingredient too long: "${ing.name}"` });
      continue;
    }
    options.push({ name: `No ${ing.name}`, priceDeltaCents: 0 });
    options.push({ name: `Extra ${ing.name}`, priceDeltaCents: ing.priceDeltaCents });
  }
  return { options, errors };
}

export function parsePastedText(text: string, columns: ColumnKey[]): RawRow[] {
  const rows: RawRow[] = [];
  for (const rawLine of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (rawLine.trim() === "") continue;
    const cells = rawLine.includes("\t") ? rawLine.split("\t") : rawLine.split(",");
    const row: RawRow = {};
    columns.forEach((col, i) => {
      const cell = (cells[i] ?? "").trim();
      if (cell) row[col] = cell;
    });
    rows.push(row);
  }
  return rows;
}
