import { describe, it, expect } from "vitest";
import {
  REGIONS,
  DEFAULT_REGION,
  COUNTRY_CODES,
  CURRENCY_CODES,
  regionForCountry,
} from "./regions";

describe("regions", () => {
  it("defaults to United States / USD", () => {
    expect(DEFAULT_REGION.country).toBe("US");
    expect(DEFAULT_REGION.currency).toBe("USD");
  });

  it("offers the US + LATAM launch market (incl. MX and BR)", () => {
    const countries = REGIONS.map((r) => r.country);
    expect(countries).toContain("MX");
    expect(countries).toContain("BR");
    expect(REGIONS.find((r) => r.country === "MX")!.currency).toBe("MXN");
    expect(REGIONS.find((r) => r.country === "BR")!.currency).toBe("BRL");
  });

  it("maps a country to its region, falling back to the default when unknown", () => {
    expect(regionForCountry("MX").currency).toBe("MXN");
    expect(regionForCountry("ZZ")).toBe(DEFAULT_REGION);
  });

  it("exposes non-empty code tuples aligned with REGIONS", () => {
    expect(COUNTRY_CODES).toEqual(REGIONS.map((r) => r.country));
    expect(CURRENCY_CODES).toEqual(REGIONS.map((r) => r.currency));
  });
});
