import { PrismaClient } from "@prisma/client";

/**
 * Prisma singleton. In dev, Next.js hot-reload would otherwise spawn a new
 * client (and connection pool) on every change.
 */
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
