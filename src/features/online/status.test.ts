import { describe, it, expect } from "vitest";
import {
  nextOnlineStatus,
  isStockCommittedAt,
  ACTIVE_ONLINE_STATUSES,
  type OnlineStatus,
} from "./status";

describe("online order status machine", () => {
  it("allows the happy path SUBMITTED → ACCEPTED → READY → COMPLETED", () => {
    expect(nextOnlineStatus("SUBMITTED", "accept")).toBe("ACCEPTED");
    expect(nextOnlineStatus("ACCEPTED", "ready")).toBe("READY");
    expect(nextOnlineStatus("READY", "complete")).toBe("COMPLETED");
  });

  it("allows ACCEPTED to skip straight to COMPLETED", () => {
    expect(nextOnlineStatus("ACCEPTED", "complete")).toBe("COMPLETED");
  });

  it("allows reject from any active status", () => {
    expect(nextOnlineStatus("SUBMITTED", "reject")).toBe("REJECTED");
    expect(nextOnlineStatus("ACCEPTED", "reject")).toBe("REJECTED");
    expect(nextOnlineStatus("READY", "reject")).toBe("REJECTED");
  });

  it("rejects invalid transitions (returns null)", () => {
    expect(nextOnlineStatus("SUBMITTED", "ready")).toBeNull();
    expect(nextOnlineStatus("SUBMITTED", "complete")).toBeNull();
    expect(nextOnlineStatus("READY", "accept")).toBeNull();
    expect(nextOnlineStatus("COMPLETED", "reject")).toBeNull();
    expect(nextOnlineStatus("REJECTED", "accept")).toBeNull();
  });

  it("marks stock committed only once accepted (ACCEPTED / READY)", () => {
    const table: [OnlineStatus, boolean][] = [
      ["SUBMITTED", false],
      ["ACCEPTED", true],
      ["READY", true],
      ["COMPLETED", false],
      ["REJECTED", false],
    ];
    for (const [status, committed] of table) {
      expect(isStockCommittedAt(status)).toBe(committed);
    }
  });

  it("lists exactly the active (on-board) statuses", () => {
    expect(ACTIVE_ONLINE_STATUSES).toEqual(["SUBMITTED", "ACCEPTED", "READY"]);
  });
});
