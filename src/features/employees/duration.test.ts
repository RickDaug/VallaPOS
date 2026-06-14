import { describe, it, expect } from "vitest";
import {
  entryDurationSeconds,
  totalDurationSeconds,
  formatDuration,
} from "./duration";

const t = (iso: string) => new Date(iso);

describe("entryDurationSeconds", () => {
  it("measures a closed entry as clockOut − clockIn (whole seconds)", () => {
    const d = entryDurationSeconds({
      clockInAt: t("2026-06-14T09:00:00Z"),
      clockOutAt: t("2026-06-14T11:30:00Z"),
    });
    expect(d).toBe(2.5 * 3600);
  });

  it("measures an open entry against `now`", () => {
    const now = t("2026-06-14T10:00:00Z");
    const d = entryDurationSeconds(
      { clockInAt: t("2026-06-14T09:00:00Z"), clockOutAt: null },
      now,
    );
    expect(d).toBe(3600);
  });

  it("clamps a negative/zero span (clock skew) to 0", () => {
    expect(
      entryDurationSeconds({
        clockInAt: t("2026-06-14T11:00:00Z"),
        clockOutAt: t("2026-06-14T10:00:00Z"),
      }),
    ).toBe(0);
    expect(
      entryDurationSeconds({
        clockInAt: t("2026-06-14T10:00:00Z"),
        clockOutAt: t("2026-06-14T10:00:00Z"),
      }),
    ).toBe(0);
  });

  it("floors sub-second remainders", () => {
    const d = entryDurationSeconds({
      clockInAt: t("2026-06-14T09:00:00.000Z"),
      clockOutAt: t("2026-06-14T09:00:01.900Z"),
    });
    expect(d).toBe(1);
  });
});

describe("totalDurationSeconds", () => {
  it("sums closed and open entries (open measured to `now`)", () => {
    const now = t("2026-06-14T12:00:00Z");
    const total = totalDurationSeconds(
      [
        { clockInAt: t("2026-06-14T08:00:00Z"), clockOutAt: t("2026-06-14T09:00:00Z") }, // 1h
        { clockInAt: t("2026-06-14T11:30:00Z"), clockOutAt: null }, // 0.5h to now
      ],
      now,
    );
    expect(total).toBe(3600 + 1800);
  });

  it("is 0 for no entries", () => {
    expect(totalDurationSeconds([])).toBe(0);
  });
});

describe("formatDuration", () => {
  it("formats hours and zero-padded minutes", () => {
    expect(formatDuration(0)).toBe("0h 00m");
    expect(formatDuration(5 * 60)).toBe("0h 05m");
    expect(formatDuration(3600)).toBe("1h 00m");
    expect(formatDuration(2 * 3600 + 5 * 60)).toBe("2h 05m");
    expect(formatDuration(10 * 3600 + 59 * 60 + 59)).toBe("10h 59m");
  });

  it("rounds down to the minute and guards non-finite/negative", () => {
    expect(formatDuration(119)).toBe("0h 01m"); // 1m59s → 1m
    expect(formatDuration(-5)).toBe("0h 00m");
    expect(formatDuration(NaN)).toBe("0h 00m");
  });
});
