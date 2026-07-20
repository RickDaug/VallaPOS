import "server-only";

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CreateLicenseInput, DesktopLicenseStore, LicenseRecord } from "./store";

const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: unknown }).code === PRISMA_UNIQUE_VIOLATION
  );
}

const SELECT = {
  id: true,
  sku: true,
  stripeSessionId: true,
  email: true,
  licenseKey: true,
  status: true,
} satisfies Prisma.LicenseSelect;

function toRecord(row: {
  id: string;
  sku: string;
  stripeSessionId: string;
  email: string;
  licenseKey: string;
  status: "ACTIVE" | "REVOKED";
}): LicenseRecord {
  return row;
}

/**
 * Prisma-backed `DesktopLicenseStore`. `create` is idempotent on the unique
 * `stripeSessionId`: on a concurrent P2002 it re-reads and returns the winner,
 * so a re-delivered webhook never errors or double-issues.
 */
export const prismaDesktopLicenseStore: DesktopLicenseStore = {
  async findByStripeSession(stripeSessionId: string): Promise<LicenseRecord | null> {
    const row = await db.license.findUnique({ where: { stripeSessionId }, select: SELECT });
    return row ? toRecord(row) : null;
  },

  async create(input: CreateLicenseInput): Promise<LicenseRecord> {
    try {
      const row = await db.license.create({ data: input, select: SELECT });
      return toRecord(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        const winner = await db.license.findUnique({
          where: { stripeSessionId: input.stripeSessionId },
          select: SELECT,
        });
        if (winner) return toRecord(winner);
      }
      throw err;
    }
  },
};
