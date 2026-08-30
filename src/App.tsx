import { useEffect, useMemo, useRef, useState } from "react";
import { createEditor, EditorHandle } from "./editor";
import { loadRates } from "./rates";
import SettingsDialog from "./SettingsDialog";
import { readTheme, saveTheme, type ThemeId } from "./theme";
import "./App.css";

const BOOK_KEY = "calcool.book.v1";
const OLD_DOC_KEY = "calcool.sheet";
const SIDEBAR_KEY = "calcool.sidebar";

const DEFAULT_DOC = `# Welcome to Calcool
Type calculations as plain sentences.

flights: $420 × 2
hotel: $180 × 6 nights
lunch was $18.50 + 20% tip
shinkansen: ¥22,000 in USD
total

// variables update everything below them
rent = $1,450
rent × 12

// units, conversions, percentages
100 pounds in kg
1 GiB in MB
0xFF to decimal
20 is what % of 160
$25/hour × 14 hours

// dates are just words too
today + 3 weeks
days until christmas
June 10 + 3 weeks
day of the week on January 24, 1984
March 3 to May 30

// clock times and timezones
now + 3 hours 15 minutes
9am to 5:30pm
time in Tokyo
6pm Sydney in Chicago
time difference between London and Tokyo
`;

interface Sheet {
  id: string;
  text: string;
  name?: string; // user rename; overrides the first-line title
  created: number;
  modified: number;
}

interface Book {
  sheets: Sheet[];
  activeId: string;
  trash: Sheet[]; // last 20 deletions, kept for recovery
}

const newSheetObj = (text = ""): Sheet => {
  const now = Date.now();
  return { id: crypto.randomUUID(), text, created: now, modified: now };
};

function loadBook(): Book {
  try {
    const raw = localStorage.getItem(BOOK_KEY);
    if (raw) {
      const b = JSON.parse(raw) as Book;
      if (Array.isArray(b.sheets) && b.sheets.length) {
        return { ...b, trash: b.trash ?? [], activeId: b.sheets.some((s) => s.id === b.activeId) ? b.activeId : b.sheets[0].id };
      }
    }
  } catch {
    /* corrupted book: fall through to a fresh one */
  }
  const first = newSheetObj(localStorage.getItem(OLD_DOC_KEY) ?? DEFAULT_DOC);
  localStorage.removeItem(OLD_DOC_KEY);
  return { sheets: [first], activeId: first.id, trash: [] };
}

export function sheetTitle(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.replace(/^[\s#/]+/, "").trim();
    if (t) return t.length > 42 ? t.slice(0, 42) + "…" : t;
  }
  return "Untitled";
}

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
  const [book, setBook] = useState<Book>(loadBook);
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
    localStorage.setItem(BOOK_KEY, JSON.stringify(book));
  }, [book]);
  useEffect(() => {
    localStorage.setItem(SIDEBAR_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  useEffect(() => {
    if (!host.current) return;
    const b = loadBook();
    const active = b.sheets.find((s) => s.id === b.activeId) ?? b.sheets[0];
    const h = createEditor(
      host.current,
      active.text,
      active.id,
      (s) => setTotal(s.totalFormatted),
      (docId, text) =>
        setBook((prev) => ({
          ...prev,
          sheets: prev.sheets.map((s) => (s.id === docId ? { ...s, text, modified: Date.now() } : s)),
        })),
    );
    handle.current = h;
    loadRates(() => h.refresh());
    return () => {
      h.destroy();
      handle.current = null;
    };
  }, []);

  // The setBook updater runs AFTER the event handler, i.e. after any setDoc call.
  // So the outgoing sheet's text must be captured synchronously and passed in,
  // never read from the editor inside the updater.
  const captureStash = (): { id: string; text: string } | null => {
    const h = handle.current;
    return h ? { id: book.activeId, text: h.getDoc() } : null;
  };
  const applyStash = (b: Book, stash: { id: string; text: string } | null): Book => {
    if (!stash) return b;
    const cur = b.sheets.find((s) => s.id === stash.id);
    if (!cur || cur.text === stash.text) return b;
    return { ...b, sheets: b.sheets.map((s) => (s.id === stash.id ? { ...s, text: stash.text, modified: Date.now() } : s)) };
  };

  const selectSheet = (id: string) => {
    if (id === book.activeId) return;
    const target = book.sheets.find((s) => s.id === id);
    if (!target) return;
    const stash = captureStash();
    setBook((prev) => ({ ...applyStash(prev, stash), activeId: id }));
    handle.current?.setDoc(target.text, id);
  };

  const addSheet = () => {
    const s = newSheetObj("");
    const stash = captureStash();
    setBook((prev) => {
      const b = applyStash(prev, stash);
      return { ...b, sheets: [s, ...b.sheets], activeId: s.id };
    });
    handle.current?.setDoc("", s.id);
    setFilter("");
  };

  const deleteSheet = (id: string) => {
    const sheet = book.sheets.find((s) => s.id === id);
    if (!sheet) return;
    const currentText = id === book.activeId ? (handle.current?.getDoc() ?? sheet.text) : sheet.text;
    if (currentText.trim() && !window.confirm(`Delete "${sheet.name || sheetTitle(currentText)}"?`)) return;

    const stash = captureStash();
    const rest = book.sheets.filter((s) => s.id !== id);
    const fresh = rest.length ? null : newSheetObj("");
    const nextActive = book.activeId !== id ? book.activeId : (rest[0] ?? fresh!).id;

    setBook((prev) => {
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
    setBook((prev) => ({ ...prev, sheets: prev.sheets.map((s) => (s.id === id ? { ...s, name: name || undefined } : s)) }));
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
    const list = [...book.sheets].sort((a, b) => b.modified - a.modified);
    const q = filter.trim().toLowerCase();
    return q ? list.filter((s) => s.text.toLowerCase().includes(q) || (s.name ?? "").toLowerCase().includes(q)) : list;
  }, [book.sheets, filter]);

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
                className={"sheet-item" + (s.id === book.activeId ? " active" : "")}
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
                    {s.name || sheetTitle(s.id === book.activeId ? (handle.current?.getDoc() ?? s.text) : s.text)}
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
