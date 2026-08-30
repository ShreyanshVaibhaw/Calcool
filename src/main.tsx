import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import Quick from "./Quick";
import { applySettings, loadSettings, SETTINGS_KEY } from "./settings";
import { applyTheme, initializeTheme, normalizeTheme, THEME_KEY } from "./theme";

initializeTheme();
applySettings();

// Keep the quick-calculator window in sync when the main window changes theme or settings.
window.addEventListener("storage", (event) => {
  if (event.key === THEME_KEY) applyTheme(normalizeTheme(event.newValue));
  if (event.key === SETTINGS_KEY) applySettings();
});

const isQuick = new URLSearchParams(window.location.search).has("quick");
if (isQuick) document.body.classList.add("quick-body");

// a saved quick-popup hotkey overrides the startup candidate chain (no-op in the browser)
if (!isQuick) {
  const hk = loadSettings().hotkey;
  if (hk) invoke("set_hotkey", { accel: hk }).catch(() => {});
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{isQuick ? <Quick /> : <App />}</React.StrictMode>,
);
