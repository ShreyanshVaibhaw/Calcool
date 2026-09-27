import { describe, expect, test } from "vitest";
import { evaluateSheet, maskComments } from "../sheet";

// Direct sheet-helper coverage (plan2 WS-1): maskComments edge cases and
// affine temperature edges. The golden suite covers happy paths; these pin
// the guards (://, inch marks, #tag vs # note) and negative temperatures.

const line = (input: string): string => evaluateSheet(input).lines[0].formatted;
const sp = (n: number): string => " ".repeat(n);

describe("maskComments", () => {
  test("masks // comments", () => {
    expect(maskComments("// note")).toEqual({ masked: sp(7), spans: [{ from: 0, to: 7 }] });
    expect(maskComments("5 + 5 // ten")).toEqual({ masked: "5 + 5 " + sp(6), spans: [{ from: 6, to: 12 }] });
  });

  test("ignores // inside :// URLs", () => {
    expect(maskComments("http://x 5+5")).toEqual({ masked: "http://x 5+5", spans: [] });
  });

  test("masks quoted text", () => {
    expect(maskComments('say "rent" loudly')).toEqual({
      masked: "say " + sp(6) + " loudly",
      spans: [{ from: 4, to: 10 }],
    });
  });

  test("a quote glued to a digit is an inch mark, not a quote", () => {
    expect(maskComments('3\' 4" + 1')).toEqual({ masked: '3\' 4" + 1', spans: [] });
  });

  test("trailing # note is a comment but #tag stays math", () => {
    expect(maskComments("lunch $20 # note")).toEqual({
      masked: "lunch $20 " + sp(6),
      spans: [{ from: 10, to: 16 }],
    });
    expect(maskComments("lunch $20 #work")).toEqual({ masked: "lunch $20 #work", spans: [] });
  });

  test("empty line", () => {
    expect(maskComments("")).toEqual({ masked: "", spans: [] });
  });
});

describe("affine temperature edges", () => {
  test("crossover and negatives convert exactly", () => {
    expect(line("-40 C in F")).toBe("-40 °F");
    expect(line("-40 F in C")).toBe("-40 °C");
    expect(line("-10 C in F")).toBe("14 °F");
    expect(line("100 C in F")).toBe("212 °F");
    expect(line("212 F in C")).toBe("100 °C");
  });

  test("temperature deltas still work in expressions", () => {
    expect(line("20 C + 5")).toBe("25 °C");
  });
});
