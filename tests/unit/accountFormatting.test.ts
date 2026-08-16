import { describe, expect, it } from "vitest";
import { formatDecimalString } from "../../src/services/accountFormatting";

describe("formatDecimalString", () => {
  it("groups decimal strings beyond JavaScript's safe integer range without losing precision", () => {
    expect(formatDecimalString("9007199254740993123456789")).toBe("9,007,199,254,740,993,123,456,789");
  });

  it("preserves fractional digits, sign, and intentionally unparsed values", () => {
    expect(formatDecimalString("-0001234.5600")).toBe("-1,234.5600");
    expect(formatDecimalString("unavailable")).toBe("unavailable");
  });
});
