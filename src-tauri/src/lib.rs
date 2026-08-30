use tauri::Manager;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

// ---- sheetbook on real files: Documents\Calcool, one .calcool text file per sheet ----

fn book_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let d = app.path().document_dir().map_err(|e| e.to_string())?.join("Calcool");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

// filenames come from sheet titles; refuse anything that could escape the folder
fn safe_name(n: &str) -> bool {
    !n.is_empty() && n.ends_with(".calcool") && !n.contains(['/', '\\', ':']) && !n.contains("..")
}

#[derive(serde::Serialize)]
struct BookFile {
    file: String,
    text: String,
}

#[derive(serde::Serialize)]
struct BookLoad {
    dir: String,
    index: Option<String>,
    files: Vec<BookFile>,
}

#[tauri::command]
fn book_load(app: tauri::AppHandle) -> Result<BookLoad, String> {
    let dir = book_dir(&app)?;
    let mut files = vec![];
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) == Some("calcool") {
            if let (Some(name), Ok(text)) = (p.file_name().and_then(|s| s.to_str()), std::fs::read_to_string(&p)) {
                files.push(BookFile { file: name.to_string(), text });
            }
        }
    }
    let index = std::fs::read_to_string(dir.join("book.json")).ok();
    Ok(BookLoad { dir: dir.to_string_lossy().into_owned(), index, files })
}

// one batched save: renames, then content writes, then deletions, then the index
#[tauri::command]
fn book_save(
    app: tauri::AppHandle,
    index: String,
    writes: Vec<(String, String)>,
    renames: Vec<(String, String)>,
    deletes: Vec<String>,
) -> Result<(), String> {
    let dir = book_dir(&app)?;
    for (old, new) in &renames {
        if safe_name(old) && safe_name(new) && dir.join(old).exists() {
            let _ = std::fs::rename(dir.join(old), dir.join(new));
        }
    }
    for (name, text) in &writes {
        if safe_name(name) {
            std::fs::write(dir.join(name), text).map_err(|e| e.to_string())?;
        }
    }
    for name in &deletes {
        if safe_name(name) {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
    std::fs::write(dir.join("book.json"), index).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_book_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = book_dir(&app)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

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
        .invoke_handler(tauri::generate_handler![set_hotkey, book_load, book_save, open_book_dir])
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
