import { describe, expect, test } from "vitest";
import { collectVariables, variableAt, variableUses } from "./vars";

describe("collectVariables", () => {
  test("finds definitions in order, deduped", () => {
    expect(collectVariables("rent = 5\nrent = 6\ntax = 2")).toEqual(["rent", "tax"]);
  });

  test("finds multi-word names and skips comments", () => {
    const text = ["// rent = 5", "monthly rent = 100", "lunch $20 #note", "total"].join("\n");
    expect(collectVariables(text)).toEqual(["monthly rent"]);
  });

  test("beforeLine limits to lines above the cursor", () => {
    const text = ["a = 1", "b = 2", "c = 3"].join("\n");
    expect(collectVariables(text, 3)).toEqual(["a", "b"]);
    expect(collectVariables(text, 1)).toEqual([]);
  });

  test("comparisons and += lines define nothing", () => {
    expect(collectVariables("x == 5\ny += 3")).toEqual([]);
  });
});

describe("variableAt", () => {
  const text = ["monthly rent = 100", "monthly rent + tax"].join("\n");

  test("finds the longest covering name", () => {
    expect(variableAt(text, 1, 2)).toBe("monthly rent");
    expect(variableAt(text, 2, 10)).toBe("monthly rent");
  });

  test("returns null in prose", () => {
    expect(variableAt(text, 2, 20)).toBeNull();
    expect(variableAt("hello world", 1, 2)).toBeNull();
  });
});

describe("variableUses", () => {
  test("finds whole-word uses outside comments", () => {
    const text = ["rent = 1", "rent + rental", "// rent"].join("\n");
    const uses = variableUses(text, "rent");
    expect(uses.length).toBe(2);
    expect(text.slice(uses[0].from, uses[0].to)).toBe("rent");
  });
});
