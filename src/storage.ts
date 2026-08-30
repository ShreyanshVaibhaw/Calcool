import { invoke } from "@tauri-apps/api/core";

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
  created: number;
  modified: number;
}

export interface Book {
  sheets: Sheet[];
  activeId: string;
  trash: Sheet[]; // last 20 deletions, kept in the index for recovery
}

interface IndexEntry {
  id: string;
  file: string;
  name?: string;
  created: number;
  modified: number;
}

export const DEFAULT_DOC = `# Welcome to Calcool
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

const isTauri = "__TAURI_INTERNALS__" in window;

// ---- localStorage backend (browser dev, and the migration source) ----

function loadBookLocal(): Book {
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
  const sheets: IndexEntry[] = book.sheets.map((s) => ({ id: s.id, file: files.get(s.id)!, name: s.name, created: s.created, modified: s.modified }));
  return JSON.stringify({ activeId: book.activeId, trash: book.trash, sheets }, null, 2);
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
}

async function loadBookFs(): Promise<Book> {
  const r = await invoke<{ dir: string; index: string | null; files: { file: string; text: string }[] }>("book_load");
  const byFile = new Map(r.files.map((f) => [f.file, f.text]));
  let book: Book | null = null;

  if (r.index) {
    try {
      const idx = JSON.parse(r.index) as { activeId: string; trash: Sheet[]; sheets: IndexEntry[] };
      const sheets: Sheet[] = [];
      for (const e of idx.sheets) {
        const text = byFile.get(e.file);
        if (text === undefined) continue; // file removed outside the app
        sheets.push({ id: e.id, text, name: e.name, created: e.created, modified: e.modified });
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
        book = { sheets, trash: idx.trash ?? [], activeId: sheets.some((s) => s.id === idx.activeId) ? idx.activeId : sheets[0].id };
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
    book = { sheets, activeId: sheets[0].id, trash: [] };
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
