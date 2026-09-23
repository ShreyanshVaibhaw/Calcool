import { setWorkdayConfig, Region } from "./engine/workdays";
import { setTaxConfig } from "./engine/tax";
import { setCupSystem, CupSystem } from "./engine/units";
import { setNumFormat, setPrecision, NumRegion } from "./engine/format";

export const SETTINGS_KEY = "calcool.settings.v1";

export interface Settings {
  region: "auto" | "US" | "UK" | "IN"; // workday holiday rules
  hoursPerWorkday: number;
  taxName: string; // single word: VAT, GST...
  taxRate: number; // percent
  cup: CupSystem; // US (236.6 mL), metric (250 mL), or imperial (284.1 mL)
  numRegion: NumRegion; // answer separators: 1,000.50 vs 1.000,50 vs 1 000,50
  precision: number; // default cap on decimals for plain answers
  fontSize: number; // editor px
  fontFamily: string; // "" = theme font
  hotkey: string; // quick-popup accelerator; "" = automatic candidate chain
  syncFolder: string; // optional mirror dir for sheets (OneDrive/Dropbox); "" = off
}

export const DEFAULT_SETTINGS: Settings = {
  region: "auto",
  hoursPerWorkday: 8,
  taxName: "VAT",
  taxRate: 15,
  cup: "us",
  numRegion: "en",
  precision: 10,
  fontSize: 15,
  fontFamily: "",
  hotkey: "",
  syncFolder: "",
};

export const FONT_CHOICES = [
  { id: "", label: "System default" },
  { id: "serif", label: "Serif" },
  { id: "mono", label: "Monospace" },
];

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
  setCupSystem(s.cup ?? "us");
  setNumFormat(s.numRegion ?? "en");
  setPrecision(s.precision ?? 10);
}

// editor font vars for the editor-wrap style (fonts apply via CSS, no refresh needed)
export function fontVars(s: Settings = loadSettings()): { fontSize: string; fontFamily: string } {
  const stack = s.fontFamily === "serif" ? 'Georgia, "Times New Roman", serif' : s.fontFamily === "mono" ? '"Cascadia Code", Consolas, monospace' : undefined;
  return { fontSize: `${Math.max(10, Math.min(28, s.fontSize || 15))}px`, fontFamily: stack ?? "" };
}
