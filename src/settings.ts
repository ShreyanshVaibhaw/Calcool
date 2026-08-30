import { setWorkdayConfig, Region } from "./engine/workdays";
import { setTaxConfig } from "./engine/tax";

export const SETTINGS_KEY = "calcool.settings.v1";

export interface Settings {
  region: "auto" | "US" | "UK" | "IN"; // workday holiday rules
  hoursPerWorkday: number;
  taxName: string; // single word: VAT, GST...
  taxRate: number; // percent
  hotkey: string; // quick-popup accelerator; "" = automatic candidate chain
}

export const DEFAULT_SETTINGS: Settings = { region: "auto", hoursPerWorkday: 8, taxName: "VAT", taxRate: 15, hotkey: "" };

export const HOTKEY_CHOICES = ["Alt+Space", "Ctrl+Alt+Space", "Alt+Shift+Space", "Ctrl+Shift+Space", "Alt+Q"];

export function loadSettings(): Settings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

const localeRegion = (): Region => {
  const tag = (navigator.language || "").split("-").pop()?.toUpperCase();
  if (tag === "IN") return "IN";
  if (tag === "GB" || tag === "UK") return "UK";
  return "US";
};

// push the stored settings into the engine config (both windows call this)
export function applySettings(s: Settings = loadSettings()) {
  setWorkdayConfig({ region: s.region === "auto" ? localeRegion() : s.region, hoursPerWorkday: s.hoursPerWorkday });
  setTaxConfig({ name: s.taxName, rate: s.taxRate });
}
