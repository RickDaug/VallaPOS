/**
 * PURE reduction of a payroll-tax provider webhook event to a status update.
 *
 * Mirrors src/features/payments/connect-webhook.ts: kept separate from the route
 * handler (which does signature verification + DB writes) and from the gateways
 * (both `fake` and `check` reuse it for `parseEvent`) so the fiddly shape-parsing
 * is unit-tested without a server, an SDK, or a signed payload.
 *
 * We read DEFENSIVELY and return null (route no-ops) for anything we don't
 * recognize — never a false positive that could flip a business's onboarding or
 * a run's status on a same-shaped but unrelated event.
 *
 * Provider event shape (Check-style, docs/PAYROLL_TAX.md §webhook):
 *   { type: "company.updated",  data: { id: "com_…", onboard: { status } | status } }
 *   { type: "payroll.updated",  data: { id: "pay_…", status } }
 */

import type { ProviderEvent, ProviderStatusUpdate } from "./gateway";

/** Company-onboarding event types we act on. */
export const COMPANY_EVENT_TYPES: readonly string[] = [
  "company.updated",
  "company.onboarding.updated",
];

/** Payroll-run event types we act on. */
export const PAYROLL_EVENT_TYPES: readonly string[] = [
  "payroll.updated",
  "payroll.processed",
  "payroll.paid",
  "payroll.failed",
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Read the event's payload object (Check nests it under `data`; tolerate `object`). */
function eventData(event: ProviderEvent): Record<string, unknown> | null {
  const obj = asRecord(event.object);
  if (!obj) return null;
  return asRecord(obj.data) ?? asRecord(obj.object) ?? obj;
}

/**
 * Reduce an event to a company/payroll status update, or null when it isn't one
 * we handle. `event.type` gates the parse so a same-shaped object on an unrelated
 * event can't trip it.
 */
export function parseProviderEvent(event: ProviderEvent): ProviderStatusUpdate | null {
  const data = eventData(event);
  if (!data) return null;

  if (COMPANY_EVENT_TYPES.includes(event.type)) {
    const companyId = str(data.id);
    // Status can be top-level or nested under `onboard`/`onboarding`.
    const nested = asRecord(data.onboard) ?? asRecord(data.onboarding);
    const status = str(data.status) ?? str(nested?.status);
    if (!companyId || !status) return null;
    return { kind: "company", companyId, status };
  }

  if (PAYROLL_EVENT_TYPES.includes(event.type)) {
    const payrollId = str(data.id);
    // A type like "payroll.paid" implies the status when the body omits it.
    const implied = event.type.startsWith("payroll.") ? event.type.slice("payroll.".length) : null;
    const status = str(data.status) ?? implied;
    if (!payrollId || !status) return null;
    return { kind: "payroll", payrollId, status };
  }

  return null;
}
