import { describe, expect, test } from "vitest";
import { describeHotkeyOutcome } from "./hotkey";

describe("describeHotkeyOutcome", () => {
  test("requested accelerator registered", () => {
    expect(describeHotkeyOutcome("Alt+Q", { registered: "Alt+Q", tried: ["Alt+Q"], error: null })).toEqual({
      note: "Active: Alt+Q",
      failed: false,
    });
  });

  test("auto mode reports whatever stuck", () => {
    expect(describeHotkeyOutcome("", { registered: "Alt+Space", tried: ["Alt+Space"], error: null })).toEqual({
      note: "Active: Alt+Space",
      failed: false,
    });
  });

  test("fallback names both the taken and the active accelerator", () => {
    expect(describeHotkeyOutcome("Alt+Space", { registered: "Alt+Q", tried: ["Alt+Space", "Alt+Q"], error: null })).toEqual({
      note: "Alt+Space is taken, using Alt+Q instead",
      failed: false,
    });
  });

  test("total failure lists what was tried and flags retry", () => {
    expect(describeHotkeyOutcome("", { registered: null, tried: ["Alt+Space", "Alt+Q"], error: "denied" })).toEqual({
      note: "No hotkey could be registered (tried Alt+Space, Alt+Q)",
      failed: true,
    });
  });

  test("total failure without a tried list keeps the plain message", () => {
    expect(describeHotkeyOutcome("", { registered: null, tried: [], error: null })).toEqual({
      note: "No hotkey could be registered",
      failed: true,
    });
  });
});
