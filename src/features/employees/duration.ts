/**
 * Pure time-entry duration math. No `server-only`/Prisma imports so it can be
 * unit tested and reused by the UI without dragging server modules into the
 * bundle.
 *
 * A TimeEntry is an interval [clockInAt, clockOutAt). An OPEN entry has no
 * clockOutAt yet; its running duration is measured against "now". All durations
 * are whole seconds (we never need sub-second precision for a timesheet) and are
 * clamped to >= 0 so a clock skew can't produce a negative shift.
 */

export interface TimeInterval {
  clockInAt: Date;
  clockOutAt: Date | null;
}

/**
 * Duration of one entry in whole seconds. For an open entry, measured to `now`
 * (default: the current time). Negative spans (e.g. clock skew) clamp to 0.
 */
export function entryDurationSeconds(entry: TimeInterval, now: Date = new Date()): number {
  const end = entry.clockOutAt ?? now;
  const ms = end.getTime() - entry.clockInAt.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.floor(ms / 1000);
}

/** Sum the durations (seconds) of many entries; open entries count up to `now`. */
export function totalDurationSeconds(entries: TimeInterval[], now: Date = new Date()): number {
  return entries.reduce((sum, e) => sum + entryDurationSeconds(e, now), 0);
}

/**
 * Format whole seconds as a compact `Hh Mm` timesheet string (e.g. "2h 05m",
 * "0h 00m"). Minutes are zero-padded; we round DOWN to the minute so a shift is
 * never overstated.
 */
export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}
