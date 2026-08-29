export const THEME_KEY = "calcool.theme";

export const THEME_OPTIONS = [
  { id: "system", label: "System", description: "Follow Windows", colors: ["#ffffff", "#15151d"] },
  { id: "light", label: "Calcool Light", description: "Clean and bright", colors: ["#ffffff", "#2563eb"] },
  { id: "dark", label: "Calcool Dark", description: "The original dark theme", colors: ["#15151d", "#60a5fa"] },
  { id: "nord", label: "Nord", description: "Cool arctic blues", colors: ["#2e3440", "#88c0d0"] },
  { id: "catppuccin", label: "Catppuccin", description: "Mocha pastels", colors: ["#1e1e2e", "#cba6f7"] },
  { id: "github-dark", label: "GitHub Dark", description: "Deep neutral contrast", colors: ["#0d1117", "#2f81f7"] },
] as const;

export type ThemeId = (typeof THEME_OPTIONS)[number]["id"];

const THEME_IDS = new Set<string>(THEME_OPTIONS.map((theme) => theme.id));

export function normalizeTheme(value: unknown): ThemeId {
  return typeof value === "string" && THEME_IDS.has(value) ? (value as ThemeId) : "system";
}

export function readTheme(): ThemeId {
  try {
    return normalizeTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

export function applyTheme(theme: ThemeId) {
  if (theme === "system") {
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.dataset.theme = theme;
  }
}

export function saveTheme(theme: ThemeId) {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Theme still applies for this session when storage is unavailable.
  }
}

export function initializeTheme() {
  applyTheme(readTheme());
}
