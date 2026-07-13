import "server-only";

import { getRegisterCatalog, getManagedCatalog } from "@/features/catalog/queries";
import {
  listOrders,
  getOrderReceipt,
  getDailyReport,
  getItemSalesReport,
  getCashierSalesReport,
} from "@/features/orders/queries";
import {
  getOpenSession,
  listDrawerSessions,
  getCashCollectedSince,
  getDrawerDaySummary,
} from "@/features/cash-drawer/queries";
import { openDrawer, closeDrawer } from "@/features/cash-drawer/actions";
import { checkout } from "@/features/register/actions";
import type { DataStore } from "./types";

/**
 * Cloud (Neon/Prisma) implementation of the DataStore seam. Behavior-preserving:
 * each method delegates 1:1 to the existing, tenant-scoped `queries.ts` function
 * — no logic moves here. The `: DataStore` annotation makes TypeScript verify the
 * seam matches the real query signatures exactly.
 *
 * `server-only` because it pulls the Prisma-backed query modules; the cloud app
 * only ever resolves the store on the server.
 */
export const prismaDataStore: DataStore = {
  getRegisterCatalog,
  getManagedCatalog,
  listOrders,
  getOrderReceipt,
  getDailyReport,
  getItemSalesReport,
  getCashierSalesReport,
  getOpenSession,
  listDrawerSessions,
  getCashCollectedSince,
  getDrawerDaySummary,
  checkout,
  openDrawer,
  closeDrawer,
};
