import { describe, it, expect } from "vitest";
import {
  createModifierGroupSchema,
  createModifierSchema,
  linkSchema,
} from "./schema";

describe("createModifierGroupSchema", () => {
  const base = { businessId: "biz_1", name: "Milk", minSelect: 0, maxSelect: 1 };

  it("accepts a valid group", () => {
    expect(() => createModifierGroupSchema.parse(base)).not.toThrow();
  });

  it("accepts a required multi-select group", () => {
    expect(() =>
      createModifierGroupSchema.parse({ ...base, minSelect: 1, maxSelect: 3 }),
    ).not.toThrow();
  });

  it("rejects maxSelect < minSelect", () => {
    expect(() =>
      createModifierGroupSchema.parse({ ...base, minSelect: 2, maxSelect: 1 }),
    ).toThrow();
  });

  it("rejects maxSelect below 1 (a group must allow at least one choice)", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, maxSelect: 0 })).toThrow();
  });

  it("rejects a negative minSelect", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, minSelect: -1 })).toThrow();
  });

  it("rejects a non-integer select count", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, maxSelect: 1.5 })).toThrow();
  });

  it("rejects an empty name", () => {
    expect(() => createModifierGroupSchema.parse({ ...base, name: "" })).toThrow();
  });
});

describe("createModifierSchema", () => {
  const base = { businessId: "biz_1", groupId: "g1", name: "Oat milk", priceDeltaCents: 75 };

  it("accepts a valid modifier", () => {
    expect(() => createModifierSchema.parse(base)).not.toThrow();
  });

  it("accepts a zero price delta", () => {
    expect(() => createModifierSchema.parse({ ...base, priceDeltaCents: 0 })).not.toThrow();
  });

  it("rejects negative cents", () => {
    expect(() => createModifierSchema.parse({ ...base, priceDeltaCents: -1 })).toThrow();
  });

  it("rejects a fractional cent", () => {
    expect(() => createModifierSchema.parse({ ...base, priceDeltaCents: 75.5 })).toThrow();
  });

  it("rejects a missing groupId", () => {
    expect(() => createModifierSchema.parse({ ...base, groupId: "" })).toThrow();
  });
});

describe("linkSchema", () => {
  it("accepts a valid item/group link", () => {
    expect(() =>
      linkSchema.parse({ businessId: "biz_1", itemId: "i1", groupId: "g1" }),
    ).not.toThrow();
  });

  it("rejects a missing itemId or groupId", () => {
    expect(() => linkSchema.parse({ businessId: "biz_1", itemId: "", groupId: "g1" })).toThrow();
    expect(() => linkSchema.parse({ businessId: "biz_1", itemId: "i1", groupId: "" })).toThrow();
  });
});
