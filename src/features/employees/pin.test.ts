import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, isValidPin } from "./pin";

describe("isValidPin", () => {
  it("accepts 4–8 digit numeric PINs", () => {
    expect(isValidPin("1234")).toBe(true);
    expect(isValidPin("00000000")).toBe(true);
  });

  it("rejects too short / too long / non-numeric PINs", () => {
    expect(isValidPin("123")).toBe(false);
    expect(isValidPin("123456789")).toBe(false);
    expect(isValidPin("12a4")).toBe(false);
    expect(isValidPin("")).toBe(false);
    expect(isValidPin(" 1234")).toBe(false);
  });
});

describe("hashPin", () => {
  it("produces the salted scrypt format", () => {
    const hash = hashPin("1234");
    const parts = hash.split("$");
    expect(parts).toHaveLength(3);
    expect(parts[0]).toBe("scrypt");
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it("never embeds the plaintext PIN in the hash", () => {
    const hash = hashPin("8675");
    expect(hash).not.toContain("8675");
  });

  it("salts: the same PIN hashes differently each time", () => {
    expect(hashPin("4321")).not.toBe(hashPin("4321"));
  });

  it("throws on a malformed PIN", () => {
    expect(() => hashPin("12")).toThrow();
    expect(() => hashPin("abcd")).toThrow();
  });
});

describe("verifyPin — round trip", () => {
  it("verifies the correct PIN against its hash", () => {
    const hash = hashPin("123456");
    expect(verifyPin("123456", hash)).toBe(true);
  });

  it("rejects an incorrect PIN", () => {
    const hash = hashPin("1234");
    expect(verifyPin("4321", hash)).toBe(false);
    expect(verifyPin("12345", hash)).toBe(false);
  });

  it("rejects against a null/empty stored hash", () => {
    expect(verifyPin("1234", null)).toBe(false);
    expect(verifyPin("1234", undefined)).toBe(false);
    expect(verifyPin("1234", "")).toBe(false);
  });

  it("rejects a malformed stored hash without throwing", () => {
    expect(verifyPin("1234", "not-a-hash")).toBe(false);
    expect(verifyPin("1234", "scrypt$xyz$zzz")).toBe(false);
    expect(verifyPin("1234", "bcrypt$aa$bb")).toBe(false);
    expect(verifyPin("1234", "scrypt$aabb")).toBe(false);
  });

  it("rejects an invalid candidate PIN even with a valid hash", () => {
    const hash = hashPin("1234");
    expect(verifyPin("12", hash)).toBe(false);
    expect(verifyPin("abcd", hash)).toBe(false);
  });

  it("two distinct PINs with their own hashes don't cross-verify", () => {
    const a = hashPin("1111");
    const b = hashPin("2222");
    expect(verifyPin("1111", a)).toBe(true);
    expect(verifyPin("1111", b)).toBe(false);
    expect(verifyPin("2222", b)).toBe(true);
    expect(verifyPin("2222", a)).toBe(false);
  });
});
