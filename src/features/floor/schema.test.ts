import { describe, it, expect } from "vitest";
import {
  clamp,
  createTableSchema,
  updateTableSchema,
  quickAddTablesSchema,
  createRoomSchema,
  MAX_TABLES_PER_BUSINESS,
  MIN_TABLE_SIZE,
  MAX_TABLE_SIZE,
  FLOOR_WIDTH,
} from "./schema";

describe("clamp", () => {
  it("rounds and bounds", () => {
    expect(clamp(12.6, 0, 100)).toBe(13);
    expect(clamp(-5, 0, 100)).toBe(0);
    expect(clamp(150, 0, 100)).toBe(100);
  });
});

describe("createTableSchema", () => {
  it("applies defaults (shape/seats/size/position)", () => {
    const d = createTableSchema.parse({ businessId: "b", roomId: "r", label: "T1" });
    expect(d.shape).toBe("SQUARE");
    expect(d.seats).toBe(4);
    expect(d.width).toBe(80);
    expect(d.height).toBe(80);
  });
  it("rejects an out-of-range size", () => {
    expect(() => createTableSchema.parse({ businessId: "b", roomId: "r", label: "T1", width: MAX_TABLE_SIZE + 1 })).toThrow();
    expect(() => createTableSchema.parse({ businessId: "b", roomId: "r", label: "T1", width: MIN_TABLE_SIZE - 1 })).toThrow();
  });
  it("rejects a position past the canvas", () => {
    expect(() => createTableSchema.parse({ businessId: "b", roomId: "r", label: "T1", x: FLOOR_WIDTH + 1 })).toThrow();
  });
  it("rejects an empty or too-long label", () => {
    expect(() => createTableSchema.parse({ businessId: "b", roomId: "r", label: "" })).toThrow();
    expect(() => createTableSchema.parse({ businessId: "b", roomId: "r", label: "x".repeat(13) })).toThrow();
  });
});

describe("updateTableSchema", () => {
  it("accepts a partial (drag) update", () => {
    const d = updateTableSchema.parse({ businessId: "b", id: "t", x: 100, y: 50 });
    expect(d.x).toBe(100);
    expect(d.label).toBeUndefined();
  });
  it("rejects an update with no fields to change", () => {
    expect(() => updateTableSchema.parse({ businessId: "b", id: "t" })).toThrow();
  });
});

describe("quickAddTablesSchema", () => {
  it("defaults seats and accepts a count within the cap", () => {
    const d = quickAddTablesSchema.parse({ businessId: "b", roomId: "r", count: 8 });
    expect(d.count).toBe(8);
    expect(d.seats).toBe(4);
  });
  it("rejects a count over the per-business cap or below 1", () => {
    expect(() => quickAddTablesSchema.parse({ businessId: "b", roomId: "r", count: MAX_TABLES_PER_BUSINESS + 1 })).toThrow();
    expect(() => quickAddTablesSchema.parse({ businessId: "b", roomId: "r", count: 0 })).toThrow();
  });
});

describe("createRoomSchema", () => {
  it("trims and bounds the name", () => {
    expect(createRoomSchema.parse({ businessId: "b", name: "  Patio  " }).name).toBe("Patio");
    expect(() => createRoomSchema.parse({ businessId: "b", name: "" })).toThrow();
  });
});
