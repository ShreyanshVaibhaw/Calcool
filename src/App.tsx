import { useEffect, useMemo, useRef, useState } from "react";
import { createEditor, EditorHandle } from "./editor";
import { loadRates } from "./rates";
import SettingsDialog from "./SettingsDialog";
import { readTheme, saveTheme, type ThemeId } from "./theme";
import { loadBook, saveBook, newSheetObj, sheetTitle, decodeImportedFile, downloadFile, encodeSlvr, type Book, type Sheet } from "./storage";
import { sheetRows, toCSV, toHTML } from "./export";
import type { ModeTotals } from "./engine/sheet";
import "./App.css";

const SIDEBAR_KEY = "calcool.sidebar";
const TOTAL_MODE_KEY = "calcool.totalmode";

const TOTAL_MODES = ["sum", "average", "count", "median"] as const;
type TotalMode = (typeof TOTAL_MODES)[number];
const MODE_SYM: Record<TotalMode, string> = { sum: "Σ", average: "avg", count: "#", median: "med" };

function readTotalMode(): TotalMode {
  const m = localStorage.getItem(TOTAL_MODE_KEY);
  return (TOTAL_MODES as readonly string[]).includes(m ?? "") ? (m as TotalMode) : "sum";
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
  const [book, setBook] = useState<Book | null>(null); // null until the store loads
  const [total, setTotal] = useState("");
  const [modes, setModes] = useState<ModeTotals | null>(null);
  const [totalMode, setTotalMode] = useState<TotalMode>(readTotalMode);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(SIDEBAR_KEY) === "1");
  const [filter, setFilter] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const [exportFmt, setExportFmt] = useState<"calcool" | "txt" | "slvr" | "csv" | "html">("calcool");
  const [dropFolder, setDropFolder] = useState<string | null>(null); // "inbox" or a folder name
  const fileRef = useRef<HTMLInputElement>(null);
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
        (s) => {
          setTotal(s.totalFormatted);
          setModes(s.modes);
        },
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

  const addSheet = (folder?: string) => {
    if (!book) return;
    const s = newSheetObj("");
    if (folder) s.folder = folder;
    const stash = captureStash();
    setBook((prev) => {
      if (!prev) return prev;
      let b = applyStash(prev, stash);
      if (folder && !b.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) b = { ...b, folders: [...b.folders, folder] };
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
      return { ...b, sheets: fresh ? [fresh] : kept, activeId: nextActive, trash };
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

  const cleanFolderName = (raw: string): string | null => {
    const name = raw.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "").trim().slice(0, 60);
    return name || null;
  };

  const addFolder = () => {
    const name = cleanFolderName(window.prompt("Folder name") ?? "");
    if (!name) return;
    setBook((prev) => (prev && !prev.folders.some((f) => f.toLowerCase() === name.toLowerCase()) ? { ...prev, folders: [...prev.folders, name] } : prev));
  };

  const renameFolder = (oldName: string, raw: string) => {
    const name = cleanFolderName(raw);
    setRenamingFolder(null);
    if (!name || name === oldName) return;
    setBook((prev) => {
      if (!prev || prev.folders.some((f) => f.toLowerCase() === name.toLowerCase())) return prev;
      return {
        ...prev,
        folders: prev.folders.map((f) => (f === oldName ? name : f)),
        sheets: prev.sheets.map((s) => (s.folder === oldName ? { ...s, folder: name } : s)),
      };
    });
  };

  const deleteFolder = (name: string) => {
    if (!window.confirm(`Delete folder "${name}"? Its sheets move to Inbox.`)) return;
    setBook((prev) =>
      prev
        ? { ...prev, folders: prev.folders.filter((f) => f !== name), sheets: prev.sheets.map((s) => (s.folder === name ? { ...s, folder: undefined } : s)) }
        : prev,
    );
  };

  const moveSheet = (id: string, folder: string | undefined) => {
    setBook((prev) => {
      if (!prev) return prev;
      const known = folder === undefined || prev.folders.some((f) => f.toLowerCase() === folder.toLowerCase());
      const target = folder !== undefined && !known ? undefined : folder; // unknown drops land in Inbox
      const b = target !== undefined && !prev.folders.some((f) => f === target) ? { ...prev, folders: [...prev.folders, target] } : prev;
      return { ...b, sheets: b.sheets.map((s) => (s.id === id ? { ...s, folder: target, modified: Date.now() } : s)) };
    });
  };

  const importFiles = async (files: FileList | File[], folder?: string) => {
    if (!book) return;
    const stash = captureStash();
    const fresh: Sheet[] = [];
    for (const f of Array.from(files)) {
      try {
        const decoded = decodeImportedFile(f.name, await f.text());
        if (!decoded) continue;
        const s = newSheetObj(decoded.text);
        const title = decoded.title.trim().slice(0, 60);
        if (title) s.name = title;
        if (folder) s.folder = folder;
        fresh.push(s);
      } catch {
        /* skip unreadable files */
      }
    }
    if (!fresh.length) return;
    setBook((prev) => {
      if (!prev) return prev;
      let b = applyStash(prev, stash);
      if (folder && !b.folders.some((f) => f.toLowerCase() === folder.toLowerCase())) b = { ...b, folders: [...b.folders, folder] };
      return { ...b, sheets: [...fresh, ...b.sheets], activeId: fresh[0].id };
    });
    handle.current?.setDoc(fresh[0].text, fresh[0].id);
    setFilter("");
  };

  const exportActive = () => {
    if (!book) return;
    const s = book.sheets.find((x) => x.id === book.activeId) ?? book.sheets[0];
    if (!s) return;
    const text = s.id === book.activeId ? (handle.current?.getDoc() ?? s.text) : s.text;
    const title = (s.name || sheetTitle(text)).replace(/[<>:"/\\|?*]/g, "").trim() || "Untitled";
    if (exportFmt === "slvr") downloadFile(`${title}.slvr`, encodeSlvr(title, text), "application/json");
    else if (exportFmt === "csv") downloadFile(`${title}.csv`, toCSV(sheetRows(text)), "text/csv");
    else if (exportFmt === "html") downloadFile(`${title}.html`, toHTML(title, sheetRows(text)), "text/html");
    else downloadFile(`${title}.${exportFmt}`, text);
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

  const hasFolders = (book?.folders.length ?? 0) > 0;
  const grouped = hasFolders && !filter.trim();
  const inboxSheets = grouped && book ? visibleSheets.filter((s) => s.folder === undefined || !book.folders.includes(s.folder)) : [];
  const sheetsIn = (folder: string): Sheet[] => (grouped && book ? visibleSheets.filter((s) => s.folder === folder) : []);

  const renderSheet = (s: Sheet) => (
    <div
      key={s.id}
      className={"sheet-item" + (s.id === book?.activeId ? " active" : "")}
      draggable
      onDragStart={(e) => e.dataTransfer.setData("text/sheet-id", s.id)}
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
  );

  const folderSection = (key: string | null, header: React.ReactNode, sheets: Sheet[]) => {
    const active = dropFolder !== null && (key === null ? dropFolder === "inbox" : dropFolder === key);
    return (
      <div
        key={key ?? "inbox"}
        className={"folder-section" + (active ? " drop-target" : "")}
        onDragOver={(e) => {
          e.preventDefault();
          const next = key ?? "inbox";
          setDropFolder((d) => (d === next ? d : next));
        }}
        onDragLeave={() => setDropFolder((d) => (d === (key ?? "inbox") ? null : d))}
        onDrop={(e) => {
          e.preventDefault();
          setDropFolder(null);
          const id = e.dataTransfer.getData("text/sheet-id");
          if (id) moveSheet(id, key ?? undefined);
          else if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files, key ?? undefined);
        }}
      >
        {header}
        {sheets.map(renderSheet)}
      </div>
    );
  };

  const folderHeader = (f: string, n: number) => (
    <div className="folder-header">
      {renamingFolder === f ? (
        <input
          className="sheet-rename"
          defaultValue={f}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => renameFolder(f, e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") e.currentTarget.value = f;
            if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
          }}
        />
      ) : (
        <div
          className="folder-title"
          title="Double-click to rename"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setRenamingFolder(f);
          }}
        >
          {f} <span className="folder-count">{n}</span>
        </div>
      )}
      <button className="icon-btn" title={`New sheet in ${f}`} onClick={() => addSheet(f)}>
        +
      </button>
      <button className="icon-btn" title={`Delete folder ${f}`} onClick={() => deleteFolder(f)}>
        ×
      </button>
    </div>
  );

  const shownTotal = (modes?.[totalMode] || total) ?? "";
  const cycleMode = () => {
    setTotalMode((m) => {
      const next = TOTAL_MODES[(TOTAL_MODES.indexOf(m) + 1) % TOTAL_MODES.length];
      localStorage.setItem(TOTAL_MODE_KEY, next);
      return next;
    });
  };

  const copyTotal = () => {
    if (!shownTotal) return;
    navigator.clipboard.writeText(shownTotal).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 700);
  };

  return (
    <div className={collapsed ? "app collapsed" : "app"}>
      {!collapsed && (
        <aside className="sidebar">
          <div className="sidebar-top">
            <button className="icon-btn" title="Hide sidebar (Ctrl+\)" onClick={() => setCollapsed(true)}>
              «
            </button>
            <input className="sheet-search" placeholder="Search sheets" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="icon-btn" title="New sheet (Ctrl+N)" onClick={() => addSheet()}>
              +
            </button>
          </div>
          <div className="sheet-list">
            {!grouped && visibleSheets.map(renderSheet)}
            {grouped &&
              folderSection(
                null,
                hasFolders ? <div className="folder-header"><div className="folder-title">Inbox</div></div> : null,
                inboxSheets,
              )}
            {grouped && book?.folders.map((f) => folderSection(f, folderHeader(f, sheetsIn(f).length), sheetsIn(f)))}
            {visibleSheets.length === 0 && <div className="sheet-empty">{filter ? "No matching sheets" : "No sheets yet"}</div>}
          </div>
          <div className="sidebar-footer">
            <div className="sidebar-io">
              <select value={exportFmt} onChange={(e) => setExportFmt(e.target.value as typeof exportFmt)} title="Export format">
                <option value="calcool">.calcool</option>
                <option value="txt">.txt</option>
                <option value="slvr">.slvr</option>
                <option value="csv">.csv</option>
                <option value="html">.html</option>
              </select>
              <button className="io-btn" type="button" title="Export the active sheet" onClick={exportActive}>
                Export
              </button>
              <button className="io-btn" type="button" title="Print the active sheet (PDF via your printer)" onClick={() => window.print()}>
                Print
              </button>
              <button className="io-btn" type="button" title="Import .txt, .calcool, .slvr files" onClick={() => fileRef.current?.click()}>
                Import
              </button>
              <button className="io-btn" type="button" title="New folder" onClick={addFolder}>
                + Folder
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".txt,.calcool,.slvr,.json"
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) void importFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </div>
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
      {shownTotal && (
        <div className="total-pill">
          <button className="total-mode" type="button" title={`Total mode: ${totalMode} — click to switch`} onClick={cycleMode}>
            {MODE_SYM[totalMode]}
          </button>
          <button className="total-copy" type="button" onClick={copyTotal} title="Click to copy">
            {copied ? "copied" : shownTotal}
          </button>
        </div>
      )}
      <SettingsDialog dialogRef={settingsDialog} theme={theme} onThemeChange={chooseTheme} onEngineChange={() => handle.current?.refresh()} />
    </div>
  );
}

export default App;
