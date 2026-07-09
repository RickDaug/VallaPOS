import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isNetworkError,
  isOperatorLocked,
  runReplay,
  MAX_REPLAY_ATTEMPTS,
  type ReplayDeps,
} from "./replay-core";
import type { QueuedCheckout } from "./db";
import type { CheckoutInput } from "@/features/register/schema";

/**
 * HIGH #2 / HIGH #10: the offline replay must NEVER silently discard a
 * cash-collected sale. These tests drive the pure replay algorithm (`runReplay`)
 * over an in-memory store (no IndexedDB) so we can assert exactly what happens to
 * each queued sale on success, on a network drop, and on a persistent server
 * rejection — plus the committed-vs-needs-reconciliation counts the UI relies on.
 *
 * The real `isNetworkError` reads `navigator.onLine`; Node's global `navigator`
 * has no `onLine`, so we stub it to a connected state to exercise the *message*
 * classification (the offline case is covered explicitly via the injected deps).
 */
beforeEach(() => {
  vi.stubGlobal("navigator", { onLine: true });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

let seq = 0;
function makeEntry(clientUuid: string, attempts = 0): QueuedCheckout {
  return {
    clientUuid,
    queuedAt: ++seq, // strictly increasing → deterministic FIFO order
    attempts,
    payload: { clientUuid } as unknown as CheckoutInput,
  };
}

interface Harness {
  deps: ReplayDeps;
  queue: Map<string, QueuedCheckout>;
  dead: Map<string, { entry: QueuedCheckout; err: unknown; attempts: number }>;
  sent: string[];
}

function harness(opts: {
  entries: QueuedCheckout[];
  online?: boolean;
  send: (payload: CheckoutInput) => Promise<unknown>;
  decode?: (entry: QueuedCheckout) => Promise<CheckoutInput | null>;
  maxAttempts?: number;
}): Harness {
  const queue = new Map(opts.entries.map((e) => [e.clientUuid, { ...e }]));
  const dead = new Map<string, { entry: QueuedCheckout; err: unknown; attempts: number }>();
  const sent: string[] = [];

  const deps: ReplayDeps = {
    isOnline: () => opts.online ?? true,
    list: async () => [...queue.values()].sort((a, b) => a.queuedAt - b.queuedAt),
    decode: opts.decode ?? (async (e) => ({ clientUuid: e.clientUuid }) as unknown as CheckoutInput),
    send: async (p) => {
      sent.push((p as { clientUuid: string }).clientUuid);
      return opts.send(p);
    },
    remove: async (id) => {
      queue.delete(id);
    },
    bump: async (id) => {
      const e = queue.get(id);
      if (e) e.attempts += 1;
    },
    deadLetter: async (entry, err, attempts) => {
      dead.set(entry.clientUuid, { entry, err, attempts });
      queue.delete(entry.clientUuid);
    },
    isNetworkError,
    pendingCount: async () => queue.size,
    deadLetterCount: async () => dead.size,
    maxAttempts: opts.maxAttempts,
  };

  return { deps, queue, dead, sent };
}

describe("runReplay — success path", () => {
  it("commits each sale, removes it from the queue, and counts committed", async () => {
    const h = harness({ entries: [makeEntry("a"), makeEntry("b")], send: async () => ({}) });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(2);
    expect(s.deadLettered).toBe(0);
    expect(s.pending).toBe(0);
    expect(s.needsReconciliation).toBe(0);
    expect(h.queue.size).toBe(0);
    expect(h.dead.size).toBe(0);
    expect(h.sent).toEqual(["a", "b"]);
  });
});

describe("runReplay — network error is never destructive", () => {
  it("keeps the sale queued and STOPS the pass (FIFO, retry later)", async () => {
    const h = harness({
      entries: [makeEntry("a"), makeEntry("b")],
      send: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(0);
    expect(s.deadLettered).toBe(0);
    expect(s.pending).toBe(2); // both still queued
    expect(h.queue.size).toBe(2);
    expect(h.dead.size).toBe(0);
    expect(h.sent).toEqual(["a"]); // broke after the first failure, never tried "b"
  });
});

describe("runReplay — server rejection is retried, then dead-lettered (never deleted)", () => {
  it("below the attempt threshold: bumps attempts and keeps the sale queued", async () => {
    const h = harness({
      entries: [makeEntry("a", 0)],
      send: async () => {
        throw new Error("Variation no longer exists");
      },
    });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(0);
    expect(s.deadLettered).toBe(0);
    expect(s.pending).toBe(1);
    expect(h.queue.get("a")?.attempts).toBe(1); // bumped
    expect(h.dead.size).toBe(0); // NOT deleted, NOT dead-lettered yet
  });

  it("at the attempt threshold: MOVES the sale to the dead-letter store (not deleted)", async () => {
    const h = harness({
      entries: [makeEntry("a", MAX_REPLAY_ATTEMPTS - 1)],
      send: async () => {
        throw new Error("HTTP 500 from server");
      },
    });
    const s = await runReplay(h.deps);
    expect(s.deadLettered).toBe(1);
    expect(s.needsReconciliation).toBe(1);
    expect(s.pending).toBe(0);
    expect(h.queue.has("a")).toBe(false); // gone from the live queue…
    expect(h.dead.has("a")).toBe(true); // …but PRESERVED for reconciliation
    expect(h.dead.get("a")?.attempts).toBe(MAX_REPLAY_ATTEMPTS);
  });

  it("never deletes a cash-collected sale outright on a single non-network error", async () => {
    const h = harness({
      entries: [makeEntry("a", 0)],
      send: async () => {
        throw new Error("validation failed");
      },
    });
    await runReplay(h.deps);
    // The sale must exist SOMEWHERE — either still queued or dead-lettered.
    expect(h.queue.has("a") || h.dead.has("a")).toBe(true);
  });
});

describe("runReplay — undecodable entries are parked, not erased", () => {
  it("moves an entry that cannot be decoded into the dead-letter store without sending", async () => {
    const h = harness({
      entries: [makeEntry("a")],
      decode: async () => null,
      send: async () => ({}),
    });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(0);
    expect(s.deadLettered).toBe(1);
    expect(s.needsReconciliation).toBe(1);
    expect(h.sent).toEqual([]); // we never attempt to send something we can't read
    expect(h.dead.has("a")).toBe(true);
    expect(h.queue.has("a")).toBe(false);
  });
});

describe("runReplay — mixed pass reports committed vs needs-reconciliation", () => {
  it("counts committed and dead-lettered independently and keeps draining past a failure", async () => {
    const h = harness({
      entries: [makeEntry("a"), makeEntry("b", MAX_REPLAY_ATTEMPTS - 1), makeEntry("c")],
      send: async (p) => {
        if ((p as { clientUuid: string }).clientUuid === "b") throw new Error("permanently invalid");
        return {};
      },
    });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(2); // a and c
    expect(s.deadLettered).toBe(1); // b
    expect(s.needsReconciliation).toBe(1);
    expect(s.pending).toBe(0);
    expect(h.sent).toEqual(["a", "b", "c"]); // a non-network failure does NOT stop the pass
    expect(h.dead.has("b")).toBe(true);
  });
});

describe("runReplay — offline short-circuit", () => {
  it("does nothing when offline and reports the queue as still pending", async () => {
    const h = harness({ entries: [makeEntry("a")], online: false, send: async () => ({}) });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(0);
    expect(s.deadLettered).toBe(0);
    expect(s.pending).toBe(1);
    expect(h.sent).toEqual([]);
  });
});

describe("runReplay — offline-replay dating (Round-3 #4)", () => {
  it("threads the entry's queuedAt onto the replayed payload as offlineQueuedAt", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const entry = makeEntry("a");
    const h = harness({
      entries: [entry],
      send: async (p) => {
        seen.push(p as Record<string, unknown>);
        return {};
      },
    });
    await runReplay(h.deps);
    expect(seen).toHaveLength(1);
    // The order is dated to when it was RUNG (the queue entry's queuedAt), not
    // when it replayed — the server reads this onto Order.createdAt.
    expect(seen[0]!.offlineQueuedAt).toBe(entry.queuedAt);
  });
});

describe("runReplay — a locked device is non-terminal (Round-3 #3)", () => {
  const lockedError = () =>
    Object.assign(new Error("LOCKED"), { name: "OperatorLockedError" });

  it("halts the pass WITHOUT consuming an attempt or dead-lettering", async () => {
    const h = harness({
      entries: [makeEntry("a", 0), makeEntry("b", 0)],
      send: async () => {
        throw lockedError();
      },
    });
    const s = await runReplay(h.deps);
    expect(s.committed).toBe(0);
    expect(s.deadLettered).toBe(0);
    expect(s.pending).toBe(2); // both still queued, intact
    expect(h.dead.size).toBe(0); // NOT dead-lettered
    expect(h.queue.get("a")?.attempts).toBe(0); // attempt NOT consumed
    expect(h.sent).toEqual(["a"]); // stopped after the first lock, like a network stop
  });

  it("never dead-letters even at the attempt threshold (a lock isn't the sale's fault)", async () => {
    const h = harness({
      entries: [makeEntry("a", MAX_REPLAY_ATTEMPTS - 1)],
      send: async () => {
        throw lockedError();
      },
    });
    const s = await runReplay(h.deps);
    expect(s.deadLettered).toBe(0);
    expect(h.dead.has("a")).toBe(false);
    expect(h.queue.has("a")).toBe(true);
    expect(h.queue.get("a")?.attempts).toBe(MAX_REPLAY_ATTEMPTS - 1); // unchanged
  });
});

describe("isOperatorLocked classification", () => {
  it("recognizes the guard's OperatorLockedError by name or LOCKED message", () => {
    expect(isOperatorLocked(Object.assign(new Error("x"), { name: "OperatorLockedError" }))).toBe(
      true,
    );
    expect(isOperatorLocked(new Error("LOCKED"))).toBe(true);
  });

  it("does not misclassify ordinary errors as a lock", () => {
    expect(isOperatorLocked(new Error("Variation not found"))).toBe(false);
    expect(isOperatorLocked(new TypeError("Failed to fetch"))).toBe(false);
    expect(isOperatorLocked("LOCKED")).toBe(false); // non-Error value
    expect(isOperatorLocked(undefined)).toBe(false);
  });
});

describe("isNetworkError classification", () => {
  it("treats fetch/network failures as retryable (stop, don't discard)", () => {
    expect(isNetworkError(new TypeError("anything"))).toBe(true);
    expect(isNetworkError(new Error("Failed to fetch"))).toBe(true);
    expect(isNetworkError(new Error("NetworkError when attempting to fetch"))).toBe(true);
    expect(isNetworkError(new Error("Load failed"))).toBe(true);
    expect(isNetworkError(new Error("Connection reset"))).toBe(true);
    expect(isNetworkError(new Error("fetch failed"))).toBe(true);
    expect(isNetworkError(new Error("request timed out"))).toBe(true);
  });

  it("treats genuine server rejections as NON-network (so they get retried then dead-lettered)", () => {
    expect(isNetworkError(new Error("Variation not found"))).toBe(false);
    expect(isNetworkError(new Error("manager approval required"))).toBe(false);
    expect(isNetworkError(new Error("Invalid quantity"))).toBe(false);
    expect(isNetworkError("some string reason")).toBe(false);
    expect(isNetworkError(undefined)).toBe(false);
  });

  it("classifies everything as network while the browser reports offline", () => {
    vi.stubGlobal("navigator", { onLine: false });
    expect(isNetworkError(new Error("Invalid quantity"))).toBe(true);
  });
});
