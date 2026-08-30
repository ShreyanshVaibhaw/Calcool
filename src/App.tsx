import { useEffect, useMemo, useRef, useState } from "react";
import { createEditor, EditorHandle } from "./editor";
import { loadRates } from "./rates";
import SettingsDialog from "./SettingsDialog";
import { readTheme, saveTheme, type ThemeId } from "./theme";
import { loadBook, saveBook, newSheetObj, sheetTitle, type Book } from "./storage";
import "./App.css";

const SIDEBAR_KEY = "calcool.sidebar";

function dateLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = (day(now) - day(d)) / 86400000;
  if (diff === 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function App() {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<EditorHandle | null>(null);
  const settingsDialog = useRef<HTMLDialogElement>(null);
  const [book, setBook] = useState<Book | null>(null); // null until the store loads
  const [total, setTotal] = useState("");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeId>(readTheme);

  const chooseTheme = (nextTheme: ThemeId) => {
    setTheme(nextTheme);
    saveTheme(nextTheme);
  };

  useEffect(() => {
    if (book) saveBook(book);
  }, [book]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  // load the book (files in the app, localStorage in the browser), then mount the editor once
  useEffect(() => {
    let disposed = false;
    let h: EditorHandle | null = null;
    loadBook().then((b) => {
      if (disposed || !host.current) return;
      setBook(b);
      const active = b.sheets.find((s) => s.id === b.activeId) ?? b.sheets[0];
      h = createEditor(
        host.current,
        active.text,
        active.id,
        (s) => setTotal(s.totalFormatted),
        (docId, text) =>
          setBook((prev) =>
            prev
              ? {
                  ...prev,
                  sheets: prev.sheets.map((s) => (s.id === docId ? { ...s, text, modified: Date.now() } : s)),
                }
              : prev,
          ),
      );
      handle.current = h;
      loadRates(() => h?.refresh());
    });
    return () => {
      disposed = true;
      h?.destroy();
      handle.current = null;
    };
  }, []);

  // The setBook updater runs AFTER the event handler, i.e. after any setDoc call.
  // So the outgoing sheet's text must be captured synchronously and passed in,
  // never read from the editor inside the updater.
  const captureStash = (): { id: string; text: string } | null => {
    const h = handle.current;
    return h && book ? { id: book.activeId, text: h.getDoc() } : null;
  };
  const applyStash = (b: Book, stash: { id: string; text: string } | null): Book => {
    if (!stash) return b;
    const cur = b.sheets.find((s) => s.id === stash.id);
    if (!cur || cur.text === stash.text) return b;
    return { ...b, sheets: b.sheets.map((s) => (s.id === stash.id ? { ...s, text: stash.text, modified: Date.now() } : s)) };
  };

  const selectSheet = (id: string) => {
    if (!book || id === book.activeId) return;
    const target = book.sheets.find((s) => s.id === id);
    if (!target) return;
    const stash = captureStash();
    setBook((prev) => (prev ? { ...applyStash(prev, stash), activeId: id } : prev));
    handle.current?.setDoc(target.text, id);
  };

  const addSheet = () => {
    if (!book) return;
    const s = newSheetObj("");
    const stash = captureStash();
    setBook((prev) => {
      if (!prev) return prev;
      const b = applyStash(prev, stash);
      return { ...b, sheets: [s, ...b.sheets], activeId: s.id };
    });
    handle.current?.setDoc("", s.id);
    setFilter("");
  };

  const deleteSheet = (id: string) => {
    if (!book) return;
    const sheet = book.sheets.find((s) => s.id === id);
    if (!sheet) return;
    const currentText = id === book.activeId ? (handle.current?.getDoc() ?? sheet.text) : sheet.text;
    if (currentText.trim() && !window.confirm(`Delete "${sheet.name || sheetTitle(currentText)}"?`)) return;

    const stash = captureStash();
    const rest = book.sheets.filter((s) => s.id !== id);
    const fresh = rest.length ? null : newSheetObj("");
    const nextActive = book.activeId !== id ? book.activeId : (rest[0] ?? fresh!).id;

    setBook((prev) => {
      if (!prev) return prev;
      const b = applyStash(prev, id === prev.activeId ? null : stash); // a deleted active sheet goes to trash with its final text instead
      const dead = b.sheets.find((s) => s.id === id);
      const kept = b.sheets.filter((s) => s.id !== id);
      const deadFinal = dead && id === book.activeId && stash ? { ...dead, text: stash.text } : dead;
      const trash = deadFinal ? [deadFinal, ...b.trash].slice(0, 20) : b.trash;
      return { sheets: fresh ? [fresh] : kept, activeId: nextActive, trash };
    });
    if (nextActive !== book.activeId || fresh) {
      const t = fresh ?? rest[0];
      handle.current?.setDoc(t.text, t.id);
    }
  };

  const renameSheet = (id: string, raw: string) => {
    const name = raw.trim();
    // empty name reverts to the auto title from the first line
    setBook((prev) => (prev ? { ...prev, sheets: prev.sheets.map((s) => (s.id === id ? { ...s, name: name || undefined } : s)) } : prev));
    setRenamingId(null);
  };

  // Ctrl+N creates a sheet, Ctrl+\ toggles the sidebar, and Ctrl+, opens settings.
  const actions = useRef({ addSheet, toggle: () => setCollapsed((c) => !c), openSettings: () => settingsDialog.current?.showModal() });
  actions.current = { addSheet, toggle: () => setCollapsed((c) => !c), openSettings: () => settingsDialog.current?.showModal() };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        actions.current.addSheet();
      } else if (e.key === "\\") {
        e.preventDefault();
        actions.current.toggle();
      } else if (e.key === ",") {
        e.preventDefault();
        actions.current.openSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleSheets = useMemo(() => {
    if (!book) return [];
    const list = [...book.sheets].sort((a, b) => b.modified - a.modified);
    const q = filter.trim().toLowerCase();
    return q ? list.filter((s) => s.text.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q)) : list;
  }, [book, filter]);

  const copyTotal = () => {
    navigator.clipboard.writeText(total).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 700);
  };

  return (
    <div className="app">
      {!collapsed && (
        <aside className="sidebar">
          <div className="sidebar-top">
            <button className="icon-btn" title="Hide sidebar (Ctrl+\)" onClick={() => setCollapsed(true)}>
              «
            </button>
            <input className="sheet-search" placeholder="Search sheets" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="icon-btn" title="New sheet (Ctrl+N)" onClick={addSheet}>
              +
            </button>
          </div>
          <div className="sheet-list">
            {visibleSheets.map((s) => (
              <div
                key={s.id}
                className={"sheet-item" + (s.id === book?.activeId ? " active" : "")}
                onClick={() => selectSheet(s.id)}
              >
                {renamingId === s.id ? (
                  <input
                    className="sheet-rename"
                    defaultValue={s.name ?? ""}
                    placeholder={sheetTitle(s.text)}
                    autoFocus
                    onFocus={(e) => e.currentTarget.select()}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => renameSheet(s.id, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      // Escape restores the old name so the blur commit is a no-op
                      if (e.key === "Escape") e.currentTarget.value = s.name ?? "";
                      if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
                    }}
                  />
                ) : (
                  <div
                    className="sheet-title"
                    title="Double-click to rename"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(s.id);
                    }}
                  >
                    {s.name || sheetTitle(s.id === book?.activeId ? (handle.current?.getDoc() ?? s.text) : s.text)}
                  </div>
                )}
                <div className="sheet-meta">{dateLabel(s.modified)}</div>
                <button
                  className="sheet-del"
                  title="Delete sheet"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSheet(s.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
            {visibleSheets.length === 0 && <div className="sheet-empty">No matching sheets</div>}
          </div>
          <div className="sidebar-footer">
            <button
              className="settings-open"
              type="button"
              title="Appearance & updates (Ctrl+,)"
              onClick={() => settingsDialog.current?.showModal()}
            >
              <span aria-hidden="true">⚙</span>
              <span>Appearance & updates</span>
            </button>
          </div>
        </aside>
      )}
      {collapsed && (
        <button className="sidebar-open icon-btn" title="Show sheets (Ctrl+\)" onClick={() => setCollapsed(false)}>
          ≡
        </button>
      )}
      <div className="editor-wrap" ref={host} />
      {total && (
        <button className="total-pill" onClick={copyTotal} title="Click to copy">
          {copied ? "copied" : total}
        </button>
      )}
      <SettingsDialog dialogRef={settingsDialog} theme={theme} onThemeChange={chooseTheme} onEngineChange={() => handle.current?.refresh()} />
    </div>
  );
}

export default App;
