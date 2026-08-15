import { describe, it, expect } from "vitest";
import {
  parseProviderEvent,
  COMPANY_EVENT_TYPES,
  PAYROLL_EVENT_TYPES,
} from "./reconcile";

describe("parseProviderEvent", () => {
  it("reads a company onboarding status from top-level status", () => {
    const update = parseProviderEvent({
      type: "company.updated",
      object: { data: { id: "com_1", status: "completed" } },
    });
    expect(update).toEqual({ kind: "company", companyId: "com_1", status: "completed" });
  });

  it("reads a company status nested under onboard", () => {
    const update = parseProviderEvent({
      type: "company.onboarding.updated",
      object: { data: { id: "com_2", onboard: { status: "needs_attention" } } },
    });
    expect(update).toEqual({ kind: "company", companyId: "com_2", status: "needs_attention" });
  });

  it("reads a payroll status from the body", () => {
    const update = parseProviderEvent({
      type: "payroll.updated",
      object: { data: { id: "pay_1", status: "processing" } },
    });
    expect(update).toEqual({ kind: "payroll", payrollId: "pay_1", status: "processing" });
  });

  it("implies the payroll status from the event type when the body omits it", () => {
    const update = parseProviderEvent({
      type: "payroll.paid",
      object: { data: { id: "pay_2" } },
    });
    expect(update).toEqual({ kind: "payroll", payrollId: "pay_2", status: "paid" });
  });

  it("tolerates the payload under `object` instead of `data`", () => {
    const update = parseProviderEvent({
      type: "company.updated",
      object: { object: { id: "com_3", status: "blocked" } },
    });
    expect(update).toEqual({ kind: "company", companyId: "com_3", status: "blocked" });
  });

  it("ignores event types we don't handle (never a false positive)", () => {
    expect(parseProviderEvent({ type: "employee.updated", object: { data: { id: "emp_1" } } })).toBeNull();
    expect(parseProviderEvent({ type: "", object: { id: "com_1", status: "x" } })).toBeNull();
  });

  it("returns null when a required id or status is missing", () => {
    expect(parseProviderEvent({ type: "company.updated", object: { data: { status: "completed" } } })).toBeNull();
    expect(parseProviderEvent({ type: "company.updated", object: { data: { id: "com_1" } } })).toBeNull();
    expect(parseProviderEvent({ type: "payroll.updated", object: null })).toBeNull();
  });

  it("all handled types are namespaced provider events", () => {
    for (const t of COMPANY_EVENT_TYPES) expect(t).toMatch(/^company\./);
    for (const t of PAYROLL_EVENT_TYPES) expect(t).toMatch(/^payroll\./);
  });
});
