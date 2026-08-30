use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// Alt+Space is often owned by launchers (Flow Launcher, PowerToys Run); fall through until one sticks
const HOTKEY_CANDIDATES: [&str; 5] = ["Alt+Space", "Ctrl+Alt+Space", "Alt+Shift+Space", "Ctrl+Shift+Space", "Alt+Q"];

// Register the chosen quick-popup hotkey; empty or unregisterable falls back to the
// candidate chain. Returns what actually got registered so the UI can report it.
#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, accel: String) -> Option<String> {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    if !accel.is_empty() {
        if gs.register(accel.as_str()).is_ok() {
            eprintln!("[quick] registered {accel} (settings)");
            return Some(accel);
        }
        eprintln!("[quick] {accel} failed (settings), falling back to the chain");
    }
    for candidate in HOTKEY_CANDIDATES {
        if gs.register(candidate).is_ok() {
            eprintln!("[quick] registered {candidate} (fallback)");
            return Some(candidate.to_string());
        }
    }
    None
}

fn toggle_quick(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("quick") {
        let vis = w.is_visible().unwrap_or(false);
        eprintln!("[quick] toggle, visible={vis}");
        if vis {
            let _ = w.hide();
        } else {
            let _ = w.center();
            let r1 = w.show();
            let r2 = w.set_focus();
            eprintln!("[quick] show={r1:?} focus={r2:?}");
        }
    } else {
        eprintln!("[quick] no quick window");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    eprintln!("[quick] hotkey event {shortcut:?} {:?}", event.state());
                    if event.state() == ShortcutState::Pressed {
                        toggle_quick(app);
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![set_hotkey])
        .setup(|app| {
            let gs = app.global_shortcut();
            for candidate in HOTKEY_CANDIDATES {
                match gs.register(candidate) {
                    Ok(()) => {
                        eprintln!("[quick] registered {candidate}");
                        break;
                    }
                    Err(e) => eprintln!("[quick] {candidate} failed: {e}"),
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            // the quick popup dismisses itself when it loses focus
            if window.label() == "quick" {
                if let tauri::WindowEvent::Focused(f) = event {
                    eprintln!("[quick] focused={f}");
                    if !f {
                        let _ = window.hide();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
