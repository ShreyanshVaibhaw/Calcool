import { describe, expect, it } from "vitest";
import { cliAnswers } from "./cli";

describe("cli", () => {
  it("answers a single expression", () => {
    expect(cliAnswers("2 + 2")).toEqual(["4"]);
  });
  it("converts units", () => {
    expect(cliAnswers("100 pounds in kg")).toEqual(["45.36 kg"]);
  });
  it("answers every valued line and skips the rest", () => {
    expect(cliAnswers("// note\nrent = $1,450\nrent * 12")).toEqual(["$1,450.00", "$17,400.00"]);
  });
  it("returns nothing for a comment", () => {
    expect(cliAnswers("// just a note")).toEqual([]);
  });
  it("uses the static rate table (no fetch in the CLI)", () => {
    expect(cliAnswers("10 USD in EUR")).toEqual(["€9.00"]);
  });
  it("returns nothing for blank input", () => {
    expect(cliAnswers("   \n  ")).toEqual([]);
  });
});
