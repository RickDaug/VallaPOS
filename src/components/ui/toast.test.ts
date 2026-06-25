import { describe, it, expect } from "vitest";
import { toastReducer, type ToastItem } from "./toast-reducer";

const item = (id: number): ToastItem => ({ id, title: `t${id}`, variant: "default" });

describe("toastReducer", () => {
  it("adds toasts in order", () => {
    const s1 = toastReducer([], { type: "add", toast: item(1) });
    const s2 = toastReducer(s1, { type: "add", toast: item(2) });
    expect(s2.map((t) => t.id)).toEqual([1, 2]);
  });

  it("removes a toast by id without touching the rest", () => {
    const state = [item(1), item(2), item(3)];
    expect(toastReducer(state, { type: "remove", id: 2 }).map((t) => t.id)).toEqual([1, 3]);
  });

  it("is a no-op when removing an unknown id", () => {
    const state = [item(1)];
    expect(toastReducer(state, { type: "remove", id: 99 })).toEqual(state);
  });
});
