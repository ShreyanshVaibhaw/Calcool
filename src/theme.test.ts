import { describe, expect, it } from "vitest";
import { normalizeTheme } from "./theme";

describe("theme selection", () => {
  it("accepts every supported theme", () => {
    expect(normalizeTheme("system")).toBe("system");
    expect(normalizeTheme("nord")).toBe("nord");
    expect(normalizeTheme("catppuccin")).toBe("catppuccin");
    expect(normalizeTheme("github-dark")).toBe("github-dark");
  });

  it("falls back to the system theme for stale or malformed values", () => {
    expect(normalizeTheme("dracula")).toBe("system");
    expect(normalizeTheme(null)).toBe("system");
    expect(normalizeTheme(42)).toBe("system");
  });
});
