/**
 * Payroll-tax provider webhook endpoint (docs/PAYROLL_TAX.md).
 *
 * Handles company-onboarding + payroll-run status events: when the provider
 * advances (or regresses) a company's onboarding or a run's processing/filing
 * status, it fires an event and we mirror the status onto the cached columns
 * (`Business.payrollTaxOnboardingStatus` / `PayPeriod.checkPayrollStatus`) so the
 * UI reflects it without a provider round-trip.
 *
 * SECURITY: the request is authenticated by the provider SIGNATURE, verified via
 * `gateway.verifyWebhook` — never by a session. An unverified body is rejected 400
 * so the provider retries. The handler is idempotent: re-delivering the same event
 * just re-writes the same status. Mirrors app/api/payments/webhook/route.ts.
 *
 * DORMANT: with no gateway available (prod, CHECK_* unset) it returns 503 so a
 * misdirected webhook is visibly ignored.
 */

import { selectPayrollTaxGateway } from "@/features/payroll/tax/registry";
import {
  applyOnboardingStatusByCompanyId,
  applyPayrollStatusByPayrollId,
} from "@/features/payroll/tax/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const selection = selectPayrollTaxGateway();
  if (!selection.available) {
    return json({ error: "payroll tax not configured" }, 503);
  }

  const signature =
    request.headers.get("check-signature") ?? request.headers.get("x-check-signature");

  // Raw body is required for signature verification — read it verbatim.
  const rawBody = await request.text();

  let event;
  try {
    event = await selection.gateway.verifyWebhook(rawBody, signature);
  } catch (err) {
    console.error("Payroll-tax webhook verification failed:", err);
    return json({ error: "invalid signature" }, 400);
  }

  const update = selection.gateway.parseEvent(event);
  if (update) {
    const affected =
      update.kind === "company"
        ? await applyOnboardingStatusByCompanyId(update.companyId, update.status)
        : await applyPayrollStatusByPayrollId(update.payrollId, update.status);
    if (affected === 0) {
      const id = update.kind === "company" ? update.companyId : update.payrollId;
      console.warn(`Payroll-tax webhook for unknown ${update.kind} ${id}`);
    }
  }

  return json({ received: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
