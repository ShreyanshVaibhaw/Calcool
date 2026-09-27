import { s } from "./strings";

// Structured outcome of the set_hotkey command (see src-tauri/src/lib.rs).
export interface HotkeyResult {
  registered: string | null;
  tried: string[];
  error: string | null;
}

export interface HotkeyOutcome {
  note: string;
  failed: boolean; // true = show the retry action
}

// Pure rendering of a hotkey registration outcome for the settings dialog.
export function describeHotkeyOutcome(requested: string, r: HotkeyResult): HotkeyOutcome {
  if (r.registered) {
    if (requested && requested !== r.registered) {
      return { note: s.settings.hotkeyFallback(requested, r.registered), failed: false };
    }
    return { note: s.settings.hotkeyActive(r.registered), failed: false };
  }
  if (r.tried.length) {
    return { note: s.settings.hotkeyNoneTried(r.tried.join(", ")), failed: true };
  }
  return { note: s.settings.hotkeyNone, failed: true };
}
