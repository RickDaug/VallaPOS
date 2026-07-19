import { describe, it, expect } from "vitest";
import { parsePayHandle } from "./pay-link";

describe("parsePayHandle", () => {
  it("treats https/http URLs as openable external links", () => {
    const r = parsePayHandle("https://venmo.com/u/coffee-shop");
    expect(r.kind).toBe("link");
    expect(r.href).toBe("https://venmo.com/u/coffee-shop");
    expect(r.external).toBe(true);
    // display strips the scheme and trailing slash for readability
    expect(r.display).toBe("venmo.com/u/coffee-shop");
  });

  it("strips a trailing slash from the display of an http(s) URL", () => {
    const r = parsePayHandle("https://pay.me/biz/");
    expect(r.kind).toBe("link");
    expect(r.display).toBe("pay.me/biz");
    expect(r.external).toBe(true);
  });

  it("treats app deep links with :// as in-place (non-external) links", () => {
    const r = parsePayHandle("venmo://paycharge?txn=pay&recipients=biz");
    expect(r.kind).toBe("link");
    expect(r.href).toBe("venmo://paycharge?txn=pay&recipients=biz");
    expect(r.external).toBe(false);
    // custom-scheme display is left intact (no https:// to strip)
    expect(r.display).toBe("venmo://paycharge?txn=pay&recipients=biz");
  });

  it("treats a upi:// deep link as an in-place link", () => {
    const r = parsePayHandle("upi://pay?pa=biz@bank&pn=Biz");
    expect(r.kind).toBe("link");
    expect(r.external).toBe(false);
    expect(r.href).toBe("upi://pay?pa=biz@bank&pn=Biz");
  });

  it("treats a mailto: PIX link as an in-place link (no // scheme)", () => {
    const r = parsePayHandle("mailto:pay@biz.com?subject=Order");
    expect(r.kind).toBe("link");
    expect(r.external).toBe(false);
    expect(r.href).toBe("mailto:pay@biz.com?subject=Order");
  });

  it("treats a bare PIX email key as a copyable handle, not a link", () => {
    const r = parsePayHandle("payments@coffee.com.br");
    expect(r.kind).toBe("handle");
    expect(r.href).toBeUndefined();
    expect(r.display).toBe("payments@coffee.com.br");
    expect(r.external).toBe(false);
  });

  it("treats a bare @username handle as a copyable handle", () => {
    const r = parsePayHandle("@coffee-shop");
    expect(r.kind).toBe("handle");
    expect(r.display).toBe("@coffee-shop");
  });

  it("treats a phone-number PIX key as a copyable handle", () => {
    const r = parsePayHandle("+5511999998888");
    expect(r.kind).toBe("handle");
    expect(r.display).toBe("+5511999998888");
  });

  it("trims surrounding whitespace on both branches", () => {
    expect(parsePayHandle("  https://pay.me/x  ").href).toBe("https://pay.me/x");
    expect(parsePayHandle("  @handle  ").display).toBe("@handle");
  });

  it("returns an empty handle for a blank value", () => {
    const r = parsePayHandle("   ");
    expect(r.kind).toBe("handle");
    expect(r.display).toBe("");
  });
});
