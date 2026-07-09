import { describe, it, expect, vi } from "vitest";
import {
  fireTapFeedback,
  parseSoundEnabled,
  loadSoundEnabled,
  saveSoundEnabled,
  playClickOn,
  TAP_SOUND_STORAGE_KEY,
  type AudioContextLike,
  type OscillatorLike,
  type GainLike,
} from "@/features/register/use-tap-feedback";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe("parseSoundEnabled", () => {
  it("only enables on an explicit truthy flag", () => {
    expect(parseSoundEnabled("1")).toBe(true);
    expect(parseSoundEnabled("true")).toBe(true);
    expect(parseSoundEnabled("0")).toBe(false);
    expect(parseSoundEnabled(null)).toBe(false);
    expect(parseSoundEnabled(undefined)).toBe(false);
    expect(parseSoundEnabled("yes")).toBe(false);
  });
});

describe("load/saveSoundEnabled", () => {
  it("round-trips through storage and defaults to off", () => {
    const s = memoryStorage();
    expect(loadSoundEnabled(s)).toBe(false);
    saveSoundEnabled(true, s);
    expect(s._map.get(TAP_SOUND_STORAGE_KEY)).toBe("1");
    expect(loadSoundEnabled(s)).toBe(true);
    saveSoundEnabled(false, s);
    expect(loadSoundEnabled(s)).toBe(false);
  });

  it("degrades to off when storage is null", () => {
    expect(loadSoundEnabled(null)).toBe(false);
    expect(() => saveSoundEnabled(true, null)).not.toThrow();
  });
});

describe("fireTapFeedback", () => {
  it("vibrates with the default duration", () => {
    const vibrate = vi.fn(() => true);
    fireTapFeedback({ vibrate, soundEnabled: false });
    expect(vibrate).toHaveBeenCalledWith(12);
  });

  it("does not play sound when disabled, even if playClick is provided", () => {
    const playClick = vi.fn();
    fireTapFeedback({ soundEnabled: false, playClick });
    expect(playClick).not.toHaveBeenCalled();
  });

  it("plays sound only when enabled", () => {
    const playClick = vi.fn();
    fireTapFeedback({ soundEnabled: true, playClick });
    expect(playClick).toHaveBeenCalledOnce();
  });

  it("is a no-op-safe when vibrate is unsupported (null)", () => {
    expect(() => fireTapFeedback({ vibrate: null, soundEnabled: false })).not.toThrow();
  });

  it("swallows a throwing vibrate (e.g. outside a user gesture)", () => {
    const vibrate = vi.fn(() => {
      throw new Error("NotAllowedError");
    });
    const playClick = vi.fn();
    expect(() =>
      fireTapFeedback({ vibrate, soundEnabled: true, playClick }),
    ).not.toThrow();
    // sound still fires despite the vibrate throw
    expect(playClick).toHaveBeenCalledOnce();
  });
});

describe("playClickOn", () => {
  function mockCtx(state?: string) {
    const osc: OscillatorLike = {
      type: "",
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    const gain: GainLike = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn(),
    };
    const ctx: AudioContextLike = {
      currentTime: 10,
      destination: {},
      state,
      resume: vi.fn(),
      createOscillator: () => osc,
      createGain: () => gain,
    };
    return { ctx, osc, gain };
  }

  it("wires an oscillator through a gain to the destination and schedules start/stop", () => {
    const { ctx, osc, gain } = mockCtx("running");
    playClickOn(ctx);
    expect(osc.type).toBe("square");
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledWith(880, 10);
    expect(gain.gain.setValueAtTime).toHaveBeenCalledWith(0.05, 10);
    expect(gain.gain.exponentialRampToValueAtTime).toHaveBeenCalledWith(0.0001, 10.05);
    expect(osc.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    expect(osc.start).toHaveBeenCalledWith(10);
    expect(osc.stop).toHaveBeenCalledWith(10.06);
  });

  it("resumes a suspended context before playing", () => {
    const { ctx } = mockCtx("suspended");
    playClickOn(ctx);
    expect(ctx.resume).toHaveBeenCalledOnce();
  });
});
