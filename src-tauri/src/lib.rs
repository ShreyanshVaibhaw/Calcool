use tauri::Manager;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
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

// Atomic file write: temp file in the same directory, then rename. A crash or
// kill mid-save leaves either the old or the new content, never a truncation.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> std::io::Result<()> {
    let file = path.file_name().and_then(|s| s.to_str()).unwrap_or("file");
    let tmp = path.with_file_name(format!(".{file}.tmp-{}", std::process::id()));
    if let Err(e) = std::fs::write(&tmp, bytes) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

// Timestamped copy of `name` into `<dir>/backups/`, keeping the newest `keep`.
// Best-effort by design: callers log failures but never fail a save for backup.
fn backup_file(dir: &std::path::Path, name: &str, keep: usize) -> std::io::Result<()> {
    let src = dir.join(name);
    if !src.is_file() {
        return Ok(());
    }
    let backups = dir.join("backups");
    std::fs::create_dir_all(&backups)?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let stem = name.split('.').next().unwrap_or("backup");
    let ext = std::path::Path::new(name).extension().and_then(|s| s.to_str()).unwrap_or("bak");
    // disambiguate: coarse clocks (Windows) can repeat the same millis
    let mut dest = backups.join(format!("{stem}-{millis}.{ext}"));
    for n in 2.. {
        if !dest.exists() {
            break;
        }
        dest = backups.join(format!("{stem}-{millis}-{n}.{ext}"));
    }
    std::fs::copy(&src, &dest)?;
    let mut snaps: Vec<_> = std::fs::read_dir(&backups)?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .collect();
    snaps.sort();
    while snaps.len() > keep {
        let old = snaps.remove(0);
        let _ = std::fs::remove_file(old);
    }
    Ok(())
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
            write_atomic(&dir.join(name), text.as_bytes()).map_err(|e| e.to_string())?;
        }
    }
    for name in &deletes {
        if safe_name(name) {
            let _ = std::fs::remove_file(dir.join(name));
        }
    }
    // snapshot the outgoing index first; a bad write stays recoverable from backups/
    if let Err(e) = backup_file(&dir, "book.json", 5) {
        eprintln!("[book] index backup failed: {e}");
    }
    write_atomic(&dir.join("book.json"), index.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
fn open_book_dir(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let dir = book_dir(&app)?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

// one-way mirror of the current sheets into an optional sync folder
// (OneDrive/Dropbox): full state on every save, last-write-wins.
// Documents\Calcool stays the source of truth; no index file is written here.
// Conflict policy: there is none by design — the mirror never reads, so a file
// changed only in the sync folder is overwritten on the next save. The book-dir
// guard below refuses targets that look like a live book folder (book.json
// present), since mirroring there would delete sheets outside the current set.
#[tauri::command]
fn sync_mirror(dir: String, files: Vec<(String, String)>) -> Result<(), String> {
    let dir = std::path::PathBuf::from(&dir);
    if !dir.is_absolute() {
        return Err("sync folder must be an absolute path".into());
    }
    if dir.join("book.json").exists() {
        return Err("sync folder must not be a Calcool book folder (book.json present)".into());
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let mut keep = std::collections::HashSet::new();
    for (name, text) in &files {
        if safe_name(name) {
            write_atomic(&dir.join(name), text.as_bytes()).map_err(|e| e.to_string())?;
            keep.insert(name.clone());
        }
    }
    for e in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = e.path();
        if p.extension().and_then(|s| s.to_str()) == Some("calcool") {
            if let Some(n) = p.file_name().and_then(|s| s.to_str()) {
                if !keep.contains(n) {
                    let _ = std::fs::remove_file(&p);
                }
            }
        }
    }
    Ok(())
}

// Alt+Space is often owned by launchers (Flow Launcher, PowerToys Run); fall through until one sticks
const HOTKEY_CANDIDATES: [&str; 5] = ["Alt+Space", "Ctrl+Alt+Space", "Alt+Shift+Space", "Ctrl+Shift+Space", "Alt+Q"];

// Register the chosen quick-popup hotkey; empty or unregisterable falls back to the
// candidate chain. Returns the full outcome so the UI can report fallbacks and
// total failures (with a retry action) instead of failing silently.
#[derive(serde::Serialize)]
struct HotkeyResult {
    registered: Option<String>,
    tried: Vec<String>,
    error: Option<String>,
}

// Ordered accelerators to attempt: the requested one first, then the candidate
// chain without repeating it. Pure so tests can pin the fallback ordering.
fn hotkey_attempt_order(accel: &str) -> Vec<String> {
    let mut order = vec![];
    if !accel.is_empty() {
        order.push(accel.to_string());
    }
    for c in HOTKEY_CANDIDATES {
        if c != accel {
            order.push(c.to_string());
        }
    }
    order
}

#[tauri::command]
fn set_hotkey(app: tauri::AppHandle, accel: String) -> HotkeyResult {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let tried = hotkey_attempt_order(&accel);
    let mut error = None;
    for candidate in &tried {
        match gs.register(candidate.as_str()) {
            Ok(()) => {
                eprintln!("[quick] registered {candidate}");
                return HotkeyResult { registered: Some(candidate.clone()), tried, error: None };
            }
            Err(e) => {
                eprintln!("[quick] {candidate} failed: {e}");
                error = Some(e.to_string());
            }
        }
    }
    HotkeyResult { registered: None, tried, error }
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

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// tray icon: left-click shows the app; menu offers Show, Quick popup, Quit
fn build_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Calcool", true, None::<&str>)?;
    let quick = MenuItem::with_id(app, "quick", "Quick popup", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quick, &quit])?;
    let _tray = TrayIconBuilder::new()
        .icon(app.default_window_icon().cloned().unwrap())
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quick" => toggle_quick(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // a second launch focuses the open window instead of opening a new one
            show_main(app);
        }))
        .invoke_handler(tauri::generate_handler![set_hotkey, book_load, book_save, open_book_dir, sync_mirror])
        .setup(|app| {
            if let Err(e) = build_tray(app.handle()) {
                eprintln!("[tray] build failed: {e:?}");
            }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static CTR: AtomicU64 = AtomicU64::new(0);

    fn tmpdir(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "calcool-test-{}-{}-{}",
            std::process::id(),
            CTR.fetch_add(1, Ordering::SeqCst),
            tag
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn safe_name_allows_sheets_and_blocks_escape() {
        assert!(safe_name("Groceries.calcool"));
        assert!(safe_name("a b 2.calcool"));
        assert!(!safe_name(""));
        assert!(!safe_name("notes.txt"));
        assert!(!safe_name("../x.calcool"));
        assert!(!safe_name("a/b.calcool"));
        assert!(!safe_name("a\\.calcool"));
        assert!(!safe_name("C:x.calcool"));
        assert!(!safe_name("book.json"));
    }

    #[test]
    fn write_atomic_round_trips_and_overwrites() {
        let d = tmpdir("atomic");
        let p = d.join("s.calcool");
        write_atomic(&p, b"one").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "one");
        write_atomic(&p, b"two").unwrap();
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "two");
        // no temp litter left behind
        let leftovers: Vec<_> = std::fs::read_dir(&d).unwrap().flatten().collect();
        assert_eq!(leftovers.len(), 1);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn backup_file_snapshots_and_prunes_to_keep() {
        let d = tmpdir("backup");
        std::fs::write(d.join("book.json"), b"v1").unwrap();
        for _ in 0..7 {
            backup_file(&d, "book.json", 5).unwrap();
        }
        let snaps: Vec<_> = std::fs::read_dir(d.join("backups")).unwrap().flatten().collect();
        assert_eq!(snaps.len(), 5);
        // missing source is a no-op, not an error
        backup_file(&d, "nope.json", 5).unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn hotkey_attempt_order_prefers_requested_without_repeats() {
        assert_eq!(
            hotkey_attempt_order(""),
            HOTKEY_CANDIDATES.iter().map(|s| s.to_string()).collect::<Vec<_>>()
        );
        let order = hotkey_attempt_order("Alt+Q");
        assert_eq!(order[0], "Alt+Q");
        assert_eq!(order.len(), HOTKEY_CANDIDATES.len());
        assert_eq!(order.iter().filter(|c| c.as_str() == "Alt+Q").count(), 1);
        let custom = hotkey_attempt_order("Ctrl+F9");
        assert_eq!(custom[0], "Ctrl+F9");
        assert_eq!(custom.len(), HOTKEY_CANDIDATES.len() + 1);
    }

    #[test]
    fn sync_mirror_rejects_relative_and_book_dirs() {
        assert!(sync_mirror("relative/path".into(), vec![]).is_err());
        let d = tmpdir("mirror-guard");
        std::fs::write(d.join("book.json"), b"{}").unwrap();
        let err = sync_mirror(d.to_string_lossy().into_owned(), vec![]).unwrap_err();
        assert!(err.contains("book folder"), "unexpected error: {err}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn sync_mirror_writes_full_state_and_prunes_stale_sheets() {
        let d = tmpdir("mirror");
        std::fs::write(d.join("old.calcool"), b"stale").unwrap();
        std::fs::write(d.join("keep.txt"), b"untouched").unwrap();
        sync_mirror(
            d.to_string_lossy().into_owned(),
            vec![("a.calcool".into(), "1 + 1".into())],
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(d.join("a.calcool")).unwrap(), "1 + 1");
        assert!(!d.join("old.calcool").exists());
        assert!(d.join("keep.txt").exists());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
