import { describe, expect, test } from "vitest";
import { quickAnswer } from "./quickAnswer";
import { convertValue } from "./engine/evaluate";
import { unitById } from "./engine/units";
import { Decimal } from "./engine/value";

// Quick popup auto-convert (plan2 WS-1). Expectations derived from the same
// conversion + format rules the sheet goldens pin (see engine.test.ts).

describe("quickAnswer", () => {
  test("bare entries auto-convert via QUICK_AUTO", () => {
    expect(quickAnswer("21 miles")).toBe("33.8 km");
    expect(quickAnswer("10 kg")).toBe("22.05 lb");
  });

  test("bare foreign currency converts to USD (static table: EUR 0.90/USD)", () => {
    expect(quickAnswer("€10")).toBe("$11.11");
  });

  test("bare Fahrenheit converts to Celsius", () => {
    expect(quickAnswer("32 F")).toBe("0 °C");
  });

  test("bare Celsius converts to Fahrenheit (unitById F is temperature, not farad)", () => {
    expect(quickAnswer("0 C")).toBe("32 °F");
  });

  test("expressions and explicit conversions fall through unchanged", () => {
    expect(quickAnswer("1 + 2")).toBe("3");
    expect(quickAnswer("0 C in F")).toBe("32 °F");
  });

  test("answer-less input stays silent", () => {
    expect(quickAnswer("just some words")).toBe("");
    expect(quickAnswer("")).toBe("");
  });
});

describe("convertValue fallback contract", () => {
  test("incompatible unit conversion throws so Quick can fall back", () => {
    expect(() =>
      convertValue(
        { kind: "quantity", d: new Decimal(1), unit: unitById("m") },
        { k: "unit", unit: unitById("g") },
      ),
    ).toThrow();
  });

  test("farads still resolve by name after the F id fix", () => {
    expect(unitById("farad").category).toBe("capacitance");
    expect(unitById("F").category).toBe("temperature");
  });
});
