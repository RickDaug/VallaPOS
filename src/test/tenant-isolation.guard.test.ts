import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { glob } from "node:fs/promises";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * STATIC TENANT-ISOLATION GUARD (defense in depth — Security Audit finding M-1)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * VallaPOS's load-bearing invariant: every query/mutation on a tenant-owned
 * model MUST be scoped by `businessId`. A single forgotten `where: { businessId }`
 * is a cross-tenant data leak (see docs/ARCHITECTURE.md §3/§10, src/lib/tenant.ts).
 *
 * Isolation is correct TODAY (the audit verified every call site), but it rests
 * entirely on human discipline — there is no machine guardrail against the NEXT
 * forgotten filter. The architecture suggested a runtime Prisma `$extends` that
 * throws when a tenant model is queried without `businessId`. We deliberately do
 * NOT do that: a runtime throw is risky — it could break Better Auth's own
 * User/Session queries or, worse, surface in production. Instead this is a
 * SAFE, build-time-only static check that runs in the existing `npm test` / CI
 * quality gate, so a forgotten filter fails CI before it can ship.
 *
 * ── How the check works ──────────────────────────────────────────────────────
 * It is a pragmatic SOURCE-TEXT scan (no AST, no deps beyond node:fs) over:
 *   - src/features/**\/queries.ts
 *   - src/features/**\/actions.ts
 *   - app/**\/route.ts
 *
 * For each Prisma call `db.<model>.<op>(` or `tx.<model>.<op>(` where <model> is
 * a TENANT-OWNED delegate and <op> is a FILTER/BULK operation (one that takes a
 * `where` filter and reads or affects potentially many rows — the real
 * cross-tenant leak vectors), it extracts the call's argument text up to the
 * matching close paren and FLAGS the call unless that text contains the literal
 * `businessId` somewhere (which covers `where: { businessId }`, a nested
 * `order: { businessId }`, and the compound-unique `businessId_clientUuid` keys).
 *
 * An inline `// tenant-ok: <reason>` comment on the call's line (or the line
 * immediately above it) opts a call out — for the rare LEGITIMATE cross-tenant /
 * pre-tenant query (e.g. routing a freshly-signed-in user to their first
 * business, which is scoped by their own userId, before any businessId exists).
 *
 * ── Why these ops and not single-row writes (KNOWN LIMITATIONS) ──────────────
 * This check is CONSERVATIVE by design: it favors false-NEGATIVES over false-
 * POSITIVES (better to occasionally miss than to block legitimate code). It
 * intentionally does NOT flag single-row ops keyed by a primary/compound id:
 *   findUnique, findUniqueOrThrow, update, delete, create, createMany, upsert.
 * In this codebase those follow the audited, safe convention of either
 *   (a) carrying `businessId` in a compound unique key
 *       (`{ businessId_clientUuid: { businessId, ... } }`), or
 *   (b) being preceded by an ownership check
 *       (`findFirst({ where: { id, businessId } })`) that this scan already
 *       guards, then mutating by the verified `id` alone
 *       (e.g. `tx.order.update({ where: { id: orderId } })`).
 * Flagging those would produce unavoidable false positives, so they are out of
 * scope. Other known limits: a developer could defeat the heuristic by passing a
 * pre-built `where` object from a variable, or put the word `businessId` in a
 * call that doesn't actually filter by it. This guard is a SAFETY NET on top of
 * `requireMembership` + code review, not a proof of isolation. `tx.` calls
 * inside `$transaction` callbacks ARE scanned (same `tx.<model>.<op>(` form).
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", ".."); // src/test -> repo root

// Tenant-owned Prisma delegate names (lower-camel, as used in `db.<model>`).
// These models carry a `businessId` column (prisma/schema.prisma). NON-tenant
// models (user, session, account, verification, business, itemModifierGroup,
// orderLineModifier) are intentionally excluded.
const TENANT_MODELS = [
  "category",
  "item",
  "variation",
  "modifierGroup",
  "modifier",
  "order",
  "orderLine",
  "payment",
  "cashDrawerSession",
  "orderCounter",
  "timeEntry",
  "membership",
] as const;

// FILTER / BULK operations that take a `where` and read/affect many rows — the
// operations where a missing businessId actually leaks across tenants. Single-
// row id-keyed writes are intentionally excluded (see KNOWN LIMITATIONS above).
const GUARDED_OPS = [
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "updateMany",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
] as const;

const OPT_OUT = "tenant-ok";

const callRegex = new RegExp(
  `\\b(?:db|tx)\\.(${TENANT_MODELS.join("|")})\\.(${GUARDED_OPS.join("|")})\\s*\\(`,
  "g",
);

/** Extract the substring from the call's open paren to its matching close paren. */
function sliceCallArgs(src: string, openParenIndex: number): string {
  let depth = 0;
  for (let i = openParenIndex; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return src.slice(openParenIndex, i + 1);
    }
  }
  // Unbalanced (shouldn't happen in valid TS) — return the tail conservatively.
  return src.slice(openParenIndex);
}

/** True if a `// tenant-ok` opt-out applies to the call at `callIndex`. */
function hasOptOut(src: string, callIndex: number): boolean {
  const lines = src.slice(0, callIndex).split("\n");
  const callLineNo = lines.length - 1; // 0-based index of the call's line
  const allLines = src.split("\n");
  const callLine = allLines[callLineNo] ?? "";
  const prevLine = callLineNo > 0 ? (allLines[callLineNo - 1] ?? "") : "";
  return callLine.includes(OPT_OUT) || prevLine.includes(OPT_OUT);
}

interface Violation {
  file: string;
  line: number;
  model: string;
  op: string;
  snippet: string;
}

function scanFile(absPath: string): Violation[] {
  const src = readFileSync(absPath, "utf8");
  const violations: Violation[] = [];
  for (const m of src.matchAll(callRegex)) {
    const model = m[1]!;
    const op = m[2]!;
    const matchStart = m.index ?? 0;
    const openParen = matchStart + m[0].length - 1;
    const argText = sliceCallArgs(src, openParen);
    if (argText.includes("businessId")) continue; // correctly scoped
    if (hasOptOut(src, matchStart)) continue; // explicit, reviewed opt-out
    const line = src.slice(0, matchStart).split("\n").length;
    violations.push({
      file: relative(repoRoot, absPath).replace(/\\/g, "/"),
      line,
      model,
      op,
      snippet: `db|tx.${model}.${op}(...)`,
    });
  }
  return violations;
}

async function collectTargetFiles(): Promise<string[]> {
  const patterns = [
    "src/features/**/queries.ts",
    "src/features/**/actions.ts",
    "app/**/route.ts",
  ];
  const files: string[] = [];
  for (const pattern of patterns) {
    for await (const entry of glob(pattern, { cwd: repoRoot })) {
      files.push(join(repoRoot, entry));
    }
  }
  return files.sort();
}

describe("tenant-isolation static guard (Security Audit M-1)", () => {
  it("scans the expected surface and finds tenant-model call sites", async () => {
    const files = await collectTargetFiles();
    // Sanity: the scan surface must be non-empty, or a refactor silently
    // disabled the guard.
    expect(files.length).toBeGreaterThan(0);

    let totalGuardedCalls = 0;
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      totalGuardedCalls += [...src.matchAll(callRegex)].length;
    }
    // We know there are many guarded tenant-model calls today; if this drops to
    // zero the regex/model list is broken (false sense of safety).
    expect(totalGuardedCalls).toBeGreaterThan(0);
  });

  it("every tenant-owned filter/bulk Prisma call is scoped by businessId (or opted out)", async () => {
    const files = await collectTargetFiles();
    const violations = files.flatMap(scanFile);

    if (violations.length > 0) {
      const report = violations
        .map((v) => `  - ${v.file}:${v.line} → ${v.snippet} has no businessId in its where/args`)
        .join("\n");
      throw new Error(
        `Tenant-isolation guard found ${violations.length} unscoped tenant-model ` +
          `query(ies) — a missing businessId filter is a cross-tenant data leak:\n${report}\n\n` +
          `Fix: add \`where: { businessId }\` to the call. If this is a genuine, ` +
          `reviewed cross-tenant/admin query, annotate it with \`// ${OPT_OUT}: <reason>\`.`,
      );
    }

    expect(violations).toEqual([]);
  });
});
