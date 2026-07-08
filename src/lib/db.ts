import { PrismaClient } from "@prisma/client";
import { tenantBackstopExtension } from "@/lib/tenant-backstop";

/**
 * Prisma singleton. In dev, Next.js hot-reload would otherwise spawn a new
 * client (and connection pool) on every change.
 *
 * The client is wrapped with the RUNTIME TENANT-ISOLATION BACKSTOP
 * (src/lib/tenant-backstop.ts) — a query extension that flags any filter/bulk
 * query on a tenant-owned model that forgot `where: { businessId }`. It throws
 * in test/dev and logs-and-proceeds in production. It's a query-only extension,
 * so it does NOT change the delegate/result types callers see (`db.order.…`,
 * `db.$transaction(…)`, the Better Auth prisma adapter all keep working).
 */
function createPrismaClient() {
  return new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  }).$extends(tenantBackstopExtension);
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createPrismaClient> | undefined;
};

const client = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = client;
}

// Re-assert the plain `PrismaClient` type for callers. A *query* extension does
// not change any delegate signature or result type at runtime — it only wraps
// execution — so this cast keeps the exact type surface callers (and the Better
// Auth adapter, and `$transaction` callbacks that type `tx` as
// `Prisma.TransactionClient`) already depend on, while the runtime object still
// carries the tenant backstop.
export const db = client as unknown as PrismaClient;
