import { AsyncLocalStorage } from "node:async_hooks";
import { Prisma } from "@prisma/client";

/**
 * ───────────────────────────────────────────────────────────────────────────
 * RUNTIME TENANT-ISOLATION BACKSTOP (defense in depth — a *runtime* companion
 * to the build-time static guard in src/test/tenant-isolation.guard.test.ts)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * VallaPOS's load-bearing invariant: every filter/bulk query on a tenant-owned
 * model MUST be scoped by `businessId` (docs/ARCHITECTURE.md §3/§10,
 * src/lib/tenant.ts). A single forgotten `where: { businessId }` is a
 * cross-tenant data leak.
 *
 * The STATIC guard catches a missing filter at CI time by scanning source text.
 * This is the RUNTIME twin: a Prisma Client `$extends` query interceptor that
 * inspects the actual query args of every filter/bulk operation on a tenant
 * model and, if no `businessId` constraint is present anywhere in `where`:
 *
 *   • in test / development → THROWS loudly (so a bug is caught in tests / dev
 *     the instant the query runs), and
 *   • in production          → console.error(...) and PROCEEDS.
 *
 * The prod branch is deliberate and is the whole reason this is SAFE to ship:
 * this is a *backstop*, not a gate. It must NEVER break a live request. If a
 * bug ever slips past both the choke point and the static guard, we want a loud
 * server-log breadcrumb — not a 500 in a customer's face mid-sale. See the
 * single, clearly-commented switch in `handleMissingScope` below.
 *
 * ── Scope (mirrors the static guard exactly) ────────────────────────────────
 * Only TENANT-OWNED models (they carry a `businessId` column) and only
 * FILTER/BULK operations (the real cross-tenant leak vectors) are intercepted.
 * Single-row id-keyed ops (findUnique, create, update, delete, upsert,
 * createMany) and NON-tenant models (User/Session/Account/Verification/Business
 * + the businessId-less join tables) are intentionally NOT intercepted — the
 * same conservative boundary the static guard draws to avoid false positives,
 * and the reason Better Auth's own User/Session/Account queries sail through
 * untouched.
 *
 * ── Legitimate cross-tenant queries ─────────────────────────────────────────
 * A rare, reviewed query legitimately filters a tenant model by something OTHER
 * than businessId (e.g. routing a freshly-signed-in user to their first
 * business, scoped by their own userId before any businessId exists). The
 * static guard opts those out with an inline `// tenant-ok:` comment — invisible
 * at runtime. The runtime equivalent is `allowCrossTenant(fn)`: wrap the call
 * and the backstop stands down for its duration (via AsyncLocalStorage).
 */

/** Thrown (in test/dev only) when a tenant model is queried without a businessId filter. */
export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantScopeError";
  }
}

/**
 * Tenant-owned Prisma model names, PascalCase to match the `model` value Prisma
 * hands the `$allOperations` extension callback. This MUST stay in sync with
 * TENANT_MODELS in src/test/tenant-isolation.guard.test.ts (which lists the same
 * models in lower-camel delegate form). NON-tenant models — User, Session,
 * Account, Verification, Business, and the businessId-less join tables
 * (ItemModifierGroup, OrderLineModifier, OrderTable) — are intentionally absent.
 */
export const TENANT_MODELS: ReadonlySet<string> = new Set([
  "Category",
  "Item",
  "Variation",
  "ModifierGroup",
  "Modifier",
  "Order",
  "OrderLine",
  "Payment",
  "CashDrawerSession",
  "OrderCounter",
  "TimeEntry",
  "Membership",
  "FloorRoom",
  "FloorTable",
]);

/**
 * Filter / bulk operations that take a `where` and read/affect potentially many
 * rows — where a missing businessId actually leaks across tenants. Single-row
 * id-keyed writes are excluded (see the scope note above). Mirrors GUARDED_OPS
 * in the static guard.
 */
export const GUARDED_OPS: ReadonlySet<string> = new Set([
  "findMany",
  "findFirst",
  "findFirstOrThrow",
  "updateMany",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
]);

export function isTenantModel(model: string | undefined): boolean {
  return model != null && TENANT_MODELS.has(model);
}

export function isGuardedOp(operation: string): boolean {
  return GUARDED_OPS.has(operation);
}

/**
 * Pragmatic deep search for a `businessId` constraint anywhere in a Prisma
 * `where`. Mirrors how the static guard just looks for the literal `businessId`
 * token in the call's argument text: it returns true if ANY object key contains
 * "businessId" — covering the top-level `where: { businessId }`, a compound
 * unique key (`businessId_clientUuid`), and nested boolean combinators
 * (`AND` / `OR` / `NOT`, which are arrays or objects) — by recursing through
 * plain objects and arrays.
 *
 * Deliberately conservative: it favors false-NEGATIVES over false-POSITIVES
 * (better to occasionally miss a leak than to break a legitimate query). A
 * developer could still defeat it by building a `where` that mentions
 * businessId without actually filtering by it — this is a safety net, not a
 * proof of isolation.
 */
export function whereMentionsBusinessId(where: unknown): boolean {
  if (where == null || typeof where !== "object") return false;

  if (Array.isArray(where)) {
    return where.some((entry) => whereMentionsBusinessId(entry));
  }

  for (const [key, value] of Object.entries(where as Record<string, unknown>)) {
    // Any key mentioning businessId counts (top-level or compound-key form).
    if (key.includes("businessId")) return true;
    // Recurse into nested objects/arrays (AND/OR/NOT, relation filters, …).
    if (whereMentionsBusinessId(value)) return true;
  }
  return false;
}

/**
 * AsyncLocalStorage flag marking "we are inside a reviewed cross-tenant query".
 * The runtime equivalent of the static guard's `// tenant-ok:` opt-out.
 */
const crossTenantStore = new AsyncLocalStorage<true>();

/**
 * Run a reviewed, intentionally cross-tenant query with the backstop disabled
 * for its duration. Use ONLY when a tenant model is legitimately filtered by
 * something other than businessId (e.g. by the authenticated user's own id
 * before any active business exists). Keep the `// tenant-ok:` comment on the
 * call too, so the static guard also passes.
 *
 * The callback must INITIATE the query (return its promise) so the query
 * executes within this AsyncLocalStorage context; always `await` the result.
 */
export function allowCrossTenant<T>(fn: () => Promise<T>): Promise<T> {
  return crossTenantStore.run(true, fn);
}

/** True while executing inside `allowCrossTenant`. */
export function isCrossTenantAllowed(): boolean {
  return crossTenantStore.getStore() === true;
}

/**
 * The core decision, extracted pure for unit testing. Given a model, operation,
 * and args, decide whether this call is an unscoped tenant query that should be
 * flagged. Returns true ONLY for a guarded op on a tenant model whose `where`
 * lacks any businessId constraint and which is not inside `allowCrossTenant`.
 */
export function isUnscopedTenantQuery(
  model: string | undefined,
  operation: string,
  args: unknown,
): boolean {
  if (!isTenantModel(model)) return false;
  if (!isGuardedOp(operation)) return false;
  if (isCrossTenantAllowed()) return false;
  const where = (args as { where?: unknown } | undefined)?.where;
  return !whereMentionsBusinessId(where);
}

/**
 * The single, clearly-commented dev-vs-prod switch. A missing tenant scope is a
 * developer bug; how we react depends on the environment:
 *   • production → log and PROCEED. Never break a live request; the query is a
 *     backstop, not a gate. The error log is the breadcrumb.
 *   • test / development → THROW, so the bug surfaces immediately in CI / dev.
 */
function handleMissingScope(model: string, operation: string): void {
  const message =
    `[tenant-backstop] ${model}.${operation}() ran without a businessId filter — ` +
    `a tenant-owned query MUST be scoped by businessId (potential cross-tenant leak). ` +
    `Add \`where: { businessId }\`, or wrap a genuinely cross-tenant query in allowCrossTenant().`;

  if (process.env.NODE_ENV === "production") {
    // PROD: log loudly and proceed — a backstop must never break a live sale.
    console.error(message);
    return;
  }
  // TEST / DEV: fail loud so the missing filter is caught before it can ship.
  throw new TenantScopeError(message);
}

/**
 * Enforce the backstop for a single operation. Pure w.r.t. the DB (it never
 * touches the client) — it only inspects args and, on a violation, throws
 * (dev/test) or logs (prod). Exposed for unit testing.
 */
export function enforceTenantScope(
  model: string | undefined,
  operation: string,
  args: unknown,
): void {
  if (isUnscopedTenantQuery(model, operation, args)) {
    handleMissingScope(model as string, operation);
  }
}

/**
 * The body the extension runs for every operation, factored out so it's
 * unit-testable without a live database: run the (cheap, args-only) backstop
 * check, then delegate to the real query UNCHANGED. On a violation this throws
 * before `query` is ever called (test/dev) or logs and still calls it (prod).
 */
export function runBackstopOperation<T>(
  params: { model?: string; operation: string; args: unknown },
  query: (args: unknown) => T,
): T {
  enforceTenantScope(params.model, params.operation, params.args);
  return query(params.args);
}

/**
 * The Prisma Client extension. Applied to the exported `db` in src/lib/db.ts.
 * It intercepts every model operation, runs the backstop check, then delegates
 * to the real query unchanged. Non-tenant models and non-guarded ops fall
 * straight through, so query behavior and result types are identical for
 * callers.
 */
export const tenantBackstopExtension = Prisma.defineExtension({
  name: "tenant-runtime-backstop",
  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        return runBackstopOperation({ model, operation, args }, (a) => query(a as typeof args));
      },
    },
  },
});
