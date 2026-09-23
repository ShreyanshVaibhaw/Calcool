import { invoke } from "@tauri-apps/api/core";
import { loadSettings } from "./settings";

// The sheetbook: real .calcool text files in Documents\Calcool (via Rust commands)
// inside the app, plain localStorage in the browser dev build. book.json in the
// folder is the index (ids, order, custom names, trash); sheet text lives only
// in the files, so they can be read, edited, synced, or dropped in from outside.

const BOOK_KEY = "calcool.book.v1";
const OLD_DOC_KEY = "calcool.sheet";

export interface Sheet {
  id: string;
  text: string;
  name?: string; // user rename; overrides the first-line title
  folder?: string; // user folder; undefined = Inbox
  created: number;
  modified: number;
}

export interface Book {
  sheets: Sheet[];
  activeId: string;
  trash: Sheet[]; // last 20 deletions, kept in the index for recovery
  folders: string[]; // user folders; Inbox is implicit
}

interface IndexEntry {
  id: string;
  file: string;
  name?: string;
  folder?: string;
  created: number;
  modified: number;
}

export const DEFAULT_DOC = `# Welcome to Calcool
Type calculations as plain sentences. Answers appear on the right.

lunch was $18.50 + 20% tip
100 pounds in kg
rent = $1,450
rent * 12
today + 3 weeks
total
`;

export function sheetTitle(text: string): string {
  for (const line of text.split("\n")) {
    const t = line.replace(/^[\s#/]+/, "").trim();
    if (t) return t.length > 42 ? t.slice(0, 42) + "…" : t;
  }
  return "Untitled";
}

export const newSheetObj = (text = ""): Sheet => {
  const now = Date.now();
  return { id: crypto.randomUUID(), text, created: now, modified: now };
};

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// ---- localStorage backend (browser dev, and the migration source) ----

// Tolerant loader: old books without folders/trash still open, with everything in Inbox.
// Pure (no storage I/O), so unit tests can drive it directly.
export function normalizeBook(raw: unknown): Book {
  const b = (raw ?? {}) as Partial<Book>;
  const sheets = (Array.isArray(b.sheets) ? b.sheets : []).filter((s): s is Sheet => !!s && typeof s.id === "string");
  const trash = Array.isArray(b.trash) ? b.trash : [];
  const folders = (Array.isArray(b.folders) ? b.folders : []).filter((f): f is string => typeof f === "string" && f.trim().length > 0);
  if (!sheets.length) {
    const first = newSheetObj(DEFAULT_DOC);
    return { sheets: [first], activeId: first.id, trash: [], folders };
  }
  return {
    sheets,
    trash,
    folders,
    activeId: sheets.some((s) => s.id === b.activeId) ? (b.activeId as string) : sheets[0].id,
  };
}

function loadBookLocal(): Book {
  try {
    const raw = localStorage.getItem(BOOK_KEY);
    if (raw) return normalizeBook(JSON.parse(raw));
  } catch {
    /* corrupted book: fall through to a fresh one */
  }
  const first = newSheetObj(localStorage.getItem(OLD_DOC_KEY) ?? DEFAULT_DOC);
  localStorage.removeItem(OLD_DOC_KEY);
  return { sheets: [first], activeId: first.id, trash: [], folders: [] };
}

// ---- file backend ----

// last state persisted to disk, for diffing saves: id -> { file, text }
const onDisk = new Map<string, { file: string; text: string }>();

const sanitize = (s: string) =>
  s
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 60);

// stable human filenames: title (or custom name), deduped in sheet order
function fileNames(book: Book): Map<string, string> {
  const out = new Map<string, string>();
  const used = new Set<string>();
  for (const s of book.sheets) {
    const base = sanitize(s.name || sheetTitle(s.text)) || "Untitled";
    let name = base;
    for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base} ${i}`;
    used.add(name.toLowerCase());
    out.set(s.id, name + ".calcool");
  }
  return out;
}

function indexJson(book: Book, files: Map<string, string>): string {
  const sheets: IndexEntry[] = book.sheets.map((s) => ({ id: s.id, file: files.get(s.id)!, name: s.name, folder: s.folder, created: s.created, modified: s.modified }));
  return JSON.stringify({ activeId: book.activeId, trash: book.trash, folders: book.folders, sheets }, null, 2);
}

async function flushFs(book: Book): Promise<void> {
  const files = fileNames(book);
  const renames: [string, string][] = [];
  const writes: [string, string][] = [];
  const seen = new Set<string>();
  for (const s of book.sheets) {
    const file = files.get(s.id)!;
    seen.add(s.id);
    const prev = onDisk.get(s.id);
    if (prev && prev.file !== file) renames.push([prev.file, file]);
    if (!prev || prev.text !== s.text || prev.file !== file) writes.push([file, s.text]);
  }
  const deletes: string[] = [];
  for (const [id, prev] of onDisk) if (!seen.has(id)) deletes.push(prev.file);
  await invoke("book_save", { index: indexJson(book, files), writes, renames, deletes });
  for (const id of [...onDisk.keys()]) if (!seen.has(id)) onDisk.delete(id);
  for (const s of book.sheets) onDisk.set(s.id, { file: files.get(s.id)!, text: s.text });
  // optional one-way mirror into a cloud folder; never blocks the real save
  const syncDir = loadSettings().syncFolder?.trim();
  if (syncDir) {
    const mirror: [string, string][] = book.sheets.map((s) => [files.get(s.id)!, s.text]);
    await invoke("sync_mirror", { dir: syncDir, files: mirror }).catch((e) => console.error("sync mirror failed", e));
  }
}

async function loadBookFs(): Promise<Book> {
  const r = await invoke<{ dir: string; index: string | null; files: { file: string; text: string }[] }>("book_load");
  const byFile = new Map(r.files.map((f) => [f.file, f.text]));
  let book: Book | null = null;

  if (r.index) {
    try {
      const idx = JSON.parse(r.index) as { activeId: string; trash: Sheet[]; folders: string[]; sheets: IndexEntry[] };
      const sheets: Sheet[] = [];
      for (const e of idx.sheets) {
        const text = byFile.get(e.file);
        if (text === undefined) continue; // file removed outside the app
        sheets.push({ id: e.id, text, name: e.name, folder: e.folder, created: e.created, modified: e.modified });
        onDisk.set(e.id, { file: e.file, text });
        byFile.delete(e.file);
      }
      // files dropped into the folder from outside become sheets
      for (const [file, text] of byFile) {
        const s = newSheetObj(text);
        s.name = file.replace(/\.calcool$/, "");
        sheets.push(s);
        onDisk.set(s.id, { file, text });
      }
      if (sheets.length) {
        const folders = Array.isArray(idx.folders) ? idx.folders.filter((f) => typeof f === "string" && f.trim()) : [];
        book = { sheets, trash: idx.trash ?? [], folders, activeId: sheets.some((s) => s.id === idx.activeId) ? idx.activeId : sheets[0].id };
      }
    } catch {
      /* unreadable index: rebuild below */
    }
  }

  if (!book && byFile.size) {
    // files but no usable index: adopt them all
    const sheets = [...byFile].map(([file, text]) => {
      const s = newSheetObj(text);
      s.name = file.replace(/\.calcool$/, "");
      onDisk.set(s.id, { file, text });
      return s;
    });
    book = { sheets, activeId: sheets[0].id, trash: [], folders: [] };
  }

  if (!book) {
    // first run: migrate whatever localStorage held (or the welcome sheet)
    book = loadBookLocal();
  }

  await flushFs(book);
  return book;
}

// ---- public API ----

export function loadBook(): Promise<Book> {
  return isTauri ? loadBookFs() : Promise.resolve(loadBookLocal());
}

let pending: Book | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

export function saveBook(book: Book): void {
  if (!isTauri) {
    localStorage.setItem(BOOK_KEY, JSON.stringify(book));
    return;
  }
  pending = book;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    const b = pending!;
    pending = null;
    flushFs(b).catch((e) => console.error("sheet save failed", e));
  }, 400);
}

export const canOpenBookFolder = isTauri;
export const openBookFolder = () => invoke("open_book_dir").catch(() => {});

// ---- export / import (plain text .txt, raw .calcool, Soulver-ish .slvr JSON) ----

export function encodeSlvr(title: string, text: string): string {
  return JSON.stringify({ app: "calcool", version: 1, title, text }, null, 2);
}

// Decode a dropped or picked file by extension. Null means nothing usable inside.
export function decodeImportedFile(fileName: string, content: string): { title: string; text: string } | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (ext === "txt" || ext === "calcool" || ext === "" || !fileName.includes(".")) {
    if (!content.trim()) return null;
    return { title: fileName.replace(/\.(txt|calcool)$/i, ""), text: content };
  }
  if (ext === "slvr" || ext === "json") {
    try {
      const o = JSON.parse(content) as Record<string, unknown>;
      const text = [o.text, o.content, o.body, o.sourceText].find((v): v is string => typeof v === "string");
      if (!text?.trim()) return null;
      const title = [o.title, o.name].find((v): v is string => typeof v === "string");
      return { title: title?.trim() || fileName.replace(/\.(slvr|json)$/i, ""), text };
    } catch {
      return null;
    }
  }
  return null;
}

// Save-to-disk download; works in the browser and the Tauri webview alike.
export function downloadFile(fileName: string, content: string, mime = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
