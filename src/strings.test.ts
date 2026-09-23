import { describe, expect, it } from "vitest";
import { addLocale, s, setLocale } from "./strings";

describe("strings", () => {
  it("en table covers the UI copy components read", () => {
    expect(s.app.noSheetsYet).toBe("No sheets yet");
    expect(s.app.noMatchingSheets).toBe("No matching sheets");
    expect(s.settings.numberFormat).toBe("Number format");
    expect(s.settings.numRegionDe).toBe("1.000,50");
    expect(s.quick.placeholder).toBe("Type a calculation…");
    expect(s.shortcuts.groups.length).toBeGreaterThan(0);
    expect(s.updater.current).toBe("Calcool is up to date.");
  });

  it("dynamic copy keeps translator-controlled word order", () => {
    expect(s.app.deleteSheetConfirm("Trip")).toBe('Delete "Trip"?');
    expect(s.settings.downloadingPct(42)).toBe("Downloading 42%");
  });

  it("a second locale plugs in as data, without touching components", () => {
    addLocale("xx", { ...s, app: { ...s.app, noSheetsYet: "ZZZ" } });
    setLocale("xx");
    try {
      expect(s.app.noSheetsYet).toBe("ZZZ");
      // untouched keys fall through from the same table shape
      expect(s.app.noMatchingSheets).toBe("No matching sheets");
    } finally {
      setLocale("en");
    }
    expect(s.app.noSheetsYet).toBe("No sheets yet");
  });
});
