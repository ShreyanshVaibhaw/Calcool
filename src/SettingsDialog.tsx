import type { RefObject } from "react";
import { THEME_OPTIONS, type ThemeId } from "./theme";
import { useAppUpdater } from "./useAppUpdater";

interface SettingsDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
  theme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
}

export default function SettingsDialog({ dialogRef, theme, onThemeChange }: SettingsDialogProps) {
  const { state, busy, checkForUpdates, installUpdate } = useAppUpdater();
  const updateReady = state.phase === "available";

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
