import { useState, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { THEME_OPTIONS, type ThemeId } from "./theme";
import { useAppUpdater } from "./useAppUpdater";
import { applySettings, HOTKEY_CHOICES, loadSettings, saveSettings, type Settings } from "./settings";
import { canOpenBookFolder, openBookFolder } from "./storage";

interface SettingsDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  onEngineChange: () => void; // re-evaluate open sheets after a calculation setting changes
}

export default function SettingsDialog({ dialogRef, theme, onThemeChange, onEngineChange }: SettingsDialogProps) {
  const { state, busy, checkForUpdates, installUpdate } = useAppUpdater();
  const updateReady = state.phase === "available";
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [hotkeyNote, setHotkeyNote] = useState("");

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(next);
    applySettings(next);
    onEngineChange();
  };

  const chooseHotkey = (accel: string) => {
    update({ hotkey: accel });
    invoke<string | null>("set_hotkey", { accel })
      .then((got) => setHotkeyNote(got ? `Active: ${got}` : "No hotkey could be registered"))
      .catch(() => setHotkeyNote("Applies in the installed app"));
  };

  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="settings-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="settings-card">
        <header className="settings-header">
          <div>
            <h2 id="settings-title">Appearance & updates</h2>
            <p>Personalize Calcool and keep it current.</p>
          </div>
          <button className="settings-close" type="button" aria-label="Close settings" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>

        <fieldset className="theme-picker">
          <legend>Theme</legend>
          <div className="theme-grid">
            {THEME_OPTIONS.map((option) => (
              <label className={`theme-option${theme === option.id ? " selected" : ""}`} key={option.id}>
                <input
                  type="radio"
                  name="theme"
                  value={option.id}
                  checked={theme === option.id}
                  onChange={() => onThemeChange(option.id)}
                />
                <span className="theme-swatches" aria-hidden="true">
                  <span style={{ background: option.colors[0] }} />
                  <span style={{ background: option.colors[1] }} />
                </span>
                <span className="theme-copy">
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <section className="calc-settings" aria-labelledby="calc-title">
          <h3 id="calc-title">Calculation</h3>
          <div className="setting-row">
            <label htmlFor="set-region">Workday holidays</label>
            <select id="set-region" value={settings.region} onChange={(e) => update({ region: e.target.value as Settings["region"] })}>
              <option value="auto">Auto (OS locale)</option>
              <option value="US">United States</option>
              <option value="UK">United Kingdom</option>
              <option value="IN">India</option>
            </select>
          </div>
          <div className="setting-row">
            <label htmlFor="set-hours">Hours per workday</label>
            <input
              id="set-hours"
              type="number"
              min={1}
              max={24}
              value={settings.hoursPerWorkday}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 1 && n <= 24) update({ hoursPerWorkday: n });
              }}
            />
          </div>
          <div className="setting-row">
            <label htmlFor="set-taxname">Sales-tax word</label>
            <input
              id="set-taxname"
              type="text"
              placeholder="VAT"
              value={settings.taxName}
              onChange={(e) => update({ taxName: e.target.value.trim().split(/\s+/)[0] ?? "" })}
            />
          </div>
          <div className="setting-row">
            <label htmlFor="set-taxrate">Sales-tax rate %</label>
            <input
              id="set-taxrate"
              type="number"
              min={0}
              max={100}
              step={0.1}
              value={settings.taxRate}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (n >= 0 && n <= 100) update({ taxRate: n });
              }}
            />
          </div>
          <p className="setting-hint">
            {`"$300 + ${settings.taxName || "VAT"}", "${settings.taxName || "VAT"} on $300", and "- ${settings.taxName || "VAT"}" divides included tax back out.`}
          </p>
          <div className="setting-row">
            <label htmlFor="set-hotkey">Quick popup hotkey</label>
            <select id="set-hotkey" value={settings.hotkey} onChange={(e) => chooseHotkey(e.target.value)}>
              <option value="">Auto (first available)</option>
              {HOTKEY_CHOICES.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          {hotkeyNote && <p className="setting-hint">{hotkeyNote}</p>}
          {canOpenBookFolder && (
            <div className="setting-row">
              <label>Sheets live in Documents\Calcool</label>
              <button className="update-button" type="button" onClick={() => openBookFolder()}>
                Open sheets folder
              </button>
            </div>
          )}
        </section>

        <section className="update-panel" aria-labelledby="updates-title">
          <div className="update-copy">
            <h3 id="updates-title">App updates</h3>
            <p aria-live="polite">{state.message}</p>
          </div>
          {state.phase === "downloading" && state.progress !== undefined && (
            <progress className="update-progress" max="100" value={state.progress} aria-label="Update download progress" />
          )}
          <button
            className="update-button"
            type="button"
            disabled={busy}
            onClick={updateReady ? installUpdate : checkForUpdates}
          >
            {state.phase === "checking"
              ? "Checking..."
              : state.phase === "downloading"
                ? state.progress === undefined
                  ? "Downloading..."
                  : `Downloading ${state.progress}%`
                : state.phase === "installing"
                  ? "Installing..."
                  : updateReady
                    ? `Install ${state.version}`
                    : "Check for updates"}
          </button>
        </section>
      </div>
    </dialog>
  );
}
