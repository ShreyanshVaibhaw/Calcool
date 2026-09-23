import { describe, expect, it } from "vitest";
import { evaluateSheet } from "./engine/sheet";
import { DEFAULT_DOC } from "./storage";
import { SAMPLE_SHEETS } from "./samples";

// welcome and sample sheets must evaluate cleanly, line by line
function answers(text: string): string[] {
  return evaluateSheet(text)
    .lines.filter((l) => l.value)
    .map((l) => l.formatted);
}

describe("bundled sheets", () => {
  it("welcome sheet stays under 30 lines with five working examples", () => {
    expect(DEFAULT_DOC.split("\n").length).toBeLessThan(30);
    expect(answers(DEFAULT_DOC)).toEqual(["$22.20", "45.36 kg", "$1,450.00", "$17,400.00", expect.stringMatching(/^\d+ \w+$/), "$18,850.00"]);
  });

  it("household budget sample", () => {
    const s = SAMPLE_SHEETS.find((x) => x.title === "Household budget")!;
    expect(answers(s.text)).toEqual(["$3,200.00", "$1,450.00", "$520.00", "$180.00", "$240.00", "$810.00", "25.31%", "$6,400.00"]);
  });

  it("trip conversions sample", () => {
    const s = SAMPLE_SHEETS.find((x) => x.title === "Trip conversions")!;
    expect(answers(s.text)).toEqual(["23 kg", "50.71 lb", "514.99 km", "89.6 °F", "20 °C", "7.84 l/100km", "250.78 g"]);
  });
});
