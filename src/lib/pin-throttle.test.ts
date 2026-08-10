import { describe, it, expect, vi } from "vitest";

// Force the in-memory fallback path (no Upstash) so the test is deterministic
// and never touches the network. pin-throttle only reads these two fields.
vi.mock("@/lib/env", () => ({
  env: { UPSTASH_REDIS_REST_URL: undefined, UPSTASH_REDIS_REST_TOKEN: undefined },
}));

import {
  assertNotLocked,
  recordFailure,
  recordSuccess,
  assertApprovalNotLocked,
  recordApprovalFailure,
  recordApprovalSuccess,
  lockoutSecondsFor,
} from "./pin-throttle";

// MAX_FAILURES in the module is 5: the 5th consecutive failure locks the target.
const MAX_FAILURES = 5;

// Each test uses a distinct businessId so the module-level in-memory store
// (which persists across tests in this file) can't leak state between them.
let n = 0;
function ids() {
  n += 1;
  return { businessId: `biz-${n}`, membershipId: `mem-${n}` };
}

describe("pin-throttle (in-memory fallback)", () => {
  it("does not lock a fresh membership", async () => {
    const { businessId, membershipId } = ids();
    await expect(assertNotLocked(businessId, membershipId)).resolves.toBeUndefined();
  });

  it("stays unlocked just below the failure threshold", async () => {
    const { businessId, membershipId } = ids();
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      await recordFailure(businessId, membershipId);
    }
    await expect(assertNotLocked(businessId, membershipId)).resolves.toBeUndefined();
  });

  it("locks once consecutive failures reach the threshold", async () => {
    const { businessId, membershipId } = ids();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordFailure(businessId, membershipId);
    }
    await expect(assertNotLocked(businessId, membershipId)).rejects.toThrow();
  });

  it("recordSuccess clears the lockout and the counter", async () => {
    const { businessId, membershipId } = ids();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordFailure(businessId, membershipId);
    }
    await expect(assertNotLocked(businessId, membershipId)).rejects.toThrow();

    await recordSuccess(businessId, membershipId);
    await expect(assertNotLocked(businessId, membershipId)).resolves.toBeUndefined();

    // Counter reset too: it should take a full new run of failures to re-lock.
    for (let i = 0; i < MAX_FAILURES - 1; i++) {
      await recordFailure(businessId, membershipId);
    }
    await expect(assertNotLocked(businessId, membershipId)).resolves.toBeUndefined();
  });

  it("isolates lockouts per (businessId, membershipId)", async () => {
    const a = ids();
    const b = ids();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordFailure(a.businessId, a.membershipId);
    }
    // a is locked; b — a different membership — is untouched.
    await expect(assertNotLocked(a.businessId, a.membershipId)).rejects.toThrow();
    await expect(assertNotLocked(b.businessId, b.membershipId)).resolves.toBeUndefined();
  });
});

describe("pin-throttle — approval namespace", () => {
  it("locks the approval surface after the threshold, same as the member throttle", async () => {
    const { businessId } = ids();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordApprovalFailure(businessId);
    }
    await expect(assertApprovalNotLocked(businessId)).rejects.toThrow();
  });

  it("recordApprovalSuccess clears the approval lockout", async () => {
    const { businessId } = ids();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordApprovalFailure(businessId);
    }
    await expect(assertApprovalNotLocked(businessId)).rejects.toThrow();

    await recordApprovalSuccess(businessId);
    await expect(assertApprovalNotLocked(businessId)).resolves.toBeUndefined();
  });

  it("is isolated from a member key of the SAME business (no self-inflicted lockout)", async () => {
    const { businessId, membershipId } = ids();
    // Hammer the approval surface until it locks.
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordApprovalFailure(businessId);
    }
    await expect(assertApprovalNotLocked(businessId)).rejects.toThrow();
    // The member's personal PIN key in the same business is completely untouched.
    await expect(assertNotLocked(businessId, membershipId)).resolves.toBeUndefined();
  });

  it("member-key failures never lock the approval surface for the same business", async () => {
    const { businessId, membershipId } = ids();
    for (let i = 0; i < MAX_FAILURES; i++) {
      await recordFailure(businessId, membershipId);
    }
    await expect(assertNotLocked(businessId, membershipId)).rejects.toThrow();
    await expect(assertApprovalNotLocked(businessId)).resolves.toBeUndefined();
  });
});

describe("lockoutSecondsFor (escalating cool-down)", () => {
  it("does not lock before the failure threshold", () => {
    for (let i = 0; i < MAX_FAILURES; i++) {
      expect(lockoutSecondsFor(i)).toBe(0);
    }
  });

  it("starts at 60s and doubles with each further failure", () => {
    expect(lockoutSecondsFor(5)).toBe(60);
    expect(lockoutSecondsFor(6)).toBe(120);
    expect(lockoutSecondsFor(7)).toBe(240);
    expect(lockoutSecondsFor(8)).toBe(480);
  });

  it("caps the cool-down so a forgotten PIN can't strand a till all day", () => {
    expect(lockoutSecondsFor(9)).toBe(15 * 60);
    expect(lockoutSecondsFor(50)).toBe(15 * 60);
    // No overflow / NaN from a very long-running attack.
    expect(lockoutSecondsFor(1_000)).toBe(15 * 60);
  });

  it("throttles a sustained attack to a rate that outlasts a 4-digit PIN space", () => {
    // The property that matters: guesses-per-hour must collapse once an attacker
    // is past the threshold. At the cap that is 5 guesses per 15 minutes.
    const guessesPerHour = (3600 / lockoutSecondsFor(20)) * MAX_FAILURES;
    expect(guessesPerHour).toBeLessThan(25);
    // The flat 60s cool-down this replaced allowed ~300/hour.
  });
});
