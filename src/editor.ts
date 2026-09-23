import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType, keymap, drawSelection, highlightActiveLine, showDialog } from "@codemirror/view";
import { EditorState, StateField, StateEffect, RangeSetBuilder, MapMode, ChangeSpec, Transaction, Extension, EditorSelection } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel, gotoLine, searchPanelOpen } from "@codemirror/search";
import { autocompletion, completionKeymap, startCompletion } from "@codemirror/autocomplete";
import type { Completion, CompletionContext } from "@codemirror/autocomplete";
import { evaluateSheet, SheetOut, renameVariable } from "./engine/sheet";
import { collectVariables, variableAt, variableUses } from "./vars";
import { copyLineText, plainAnswer } from "./export";
import { Decimal } from "./engine/value";

export const recalc = StateEffect.define<null>();

const sheetField = StateField.define<SheetOut>({
  create: (state) => evaluateSheet(state.doc.toString()),
  update: (value, tr) => {
    if (tr.docChanged || tr.effects.some((e) => e.is(recalc))) return evaluateSheet(tr.state.doc.toString());
    return value;
  },
});

const TOKEN_CLASS: Record<string, string> = {
  number: "ck-num",
  unit: "ck-unit",
  currency: "ck-cur",
  operator: "ck-op",
  keyword: "ck-kw",
  function: "ck-fn",
  variable: "ck-var",
  comment: "ck-comment",
  heading: "ck-heading",
  label: "ck-label",
  tag: "ck-tag",
};

// ---------------------------------------------------------------------------
// reference tokens: "line3" renders as an atomic pill showing the live value
// ---------------------------------------------------------------------------

class RefWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly dead: boolean,
  ) {
    super();
  }
  eq(o: RefWidget) {
    return o.label === this.label && o.dead === this.dead;
  }
  toDOM() {
    const s = document.createElement("span");
    s.className = "ck-ref" + (this.dead ? " ck-ref-dead" : "");
    s.textContent = this.label;
    return s;
  }
  ignoreEvent() {
    return false;
  }
}

interface Decos {
  marks: DecorationSet;
  refs: DecorationSet;
}

const decoCache = new WeakMap<EditorState, Decos>();

function getDecos(state: EditorState): Decos {
  const cached = decoCache.get(state);
  if (cached) return cached;

  const sheet = state.field(sheetField);
  const docLen = state.doc.length;
  const all: { from: number; to: number; type: string; ref?: number }[] = [];
  for (const line of sheet.lines) for (const t of line.sem) all.push(t);
  all.sort((a, b) => a.from - b.from || a.to - b.to);

  const marks = new RangeSetBuilder<Decoration>();
  const refs = new RangeSetBuilder<Decoration>();
  let last = -1;
  for (const t of all) {
    const from = Math.min(t.from, docLen);
    const to = Math.min(t.to, docLen);
    if (from >= to || from < last) continue;
    if (t.type === "ref") {
      const tokenLine = state.doc.lineAt(from).number - 1;
      const src = t.ref !== undefined && t.ref >= 0 && t.ref < tokenLine ? sheet.lines[t.ref] : undefined;
      const dead = !src?.formatted;
      const label = dead ? `line ${(t.ref ?? -1) + 1}` : src!.formatted;
      refs.add(from, to, Decoration.replace({ widget: new RefWidget(label, dead) }));
      last = to;
      continue;
    }
    const cls = TOKEN_CLASS[t.type];
    if (!cls) continue;
    marks.add(from, to, Decoration.mark({ class: cls }));
    last = to;
  }
  const out = { marks: marks.finish(), refs: refs.finish() };
  decoCache.set(state, out);
  return out;
}

// keep lineN tokens pointing at the same physical lines when lines are added or removed;
// a reference whose target line was deleted becomes "line0", which renders as a dead pill
const refRenumber = EditorState.transactionFilter.of((tr) => {
  if (!tr.docChanged) return tr;
  const oldDoc = tr.startState.doc;
  const newDoc = tr.newDoc;
  if (oldDoc.lines === newDoc.lines) return tr; // ponytail: equal-count structural swaps are not detected

  const changes: ChangeSpec[] = [];
  const text = oldDoc.toString();
  const re = /(?<![A-Za-z0-9_])line(\d+)(?![A-Za-z0-9_])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10);
    if (n < 1 || n > oldDoc.lines) continue;
    const tokenFrom = tr.changes.mapPos(m.index, 1, MapMode.TrackDel);
    if (tokenFrom === null) continue; // the token itself was edited away
    if (newDoc.sliceString(tokenFrom, tokenFrom + m[0].length) !== m[0]) continue;
    // a deletion can erase the line but leave its boundary positions mappable,
    // so the line counts as deleted when its mapped span collapses to nothing
    const target = oldDoc.line(n);
    const t1 = tr.changes.mapPos(target.from, 1, MapMode.TrackDel);
    const t2 = tr.changes.mapPos(target.to, -1, MapMode.TrackDel);
    let replacement: string;
    if (t1 === null || t2 === null || t1 === t2) {
      replacement = "line0"; // break loudly instead of silently pointing at a different line
    } else {
      const newN = newDoc.lineAt(t1).number;
      if (newN === n) continue;
      replacement = `line${newN}`;
    }
    changes.push({ from: tokenFrom, to: tokenFrom + m[0].length, insert: replacement });
  }
  if (!changes.length) return tr;
  return [tr, { changes, sequential: true }];
});

// ---------------------------------------------------------------------------
 // find and replace (Ctrl+F), replace (Ctrl+H), go to line (Ctrl+G)
 // ---------------------------------------------------------------------------

// Ctrl+H opens find with the cursor parked in the replace field
function openReplacePanel(view: EditorView): boolean {
  if (!openSearchPanel(view)) return false;
  window.setTimeout(() => {
    const input = view.dom.querySelector('.cm-search input[name="replace"]');
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  }, 0);
  return true;
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// line actions: duplicate, comment toggle, subtotal, line reference
// ---------------------------------------------------------------------------

// lines touched by the main selection, expanded to whole lines
function selectedLines(state: EditorState): { from: number; to: number }[] {
  const { from, to } = state.selection.main;
  const first = state.doc.lineAt(from).number;
  const lastLine = state.doc.lineAt(to);
  const last = to > lastLine.from ? lastLine.number : Math.max(first, lastLine.number - (to > from ? 1 : 0));
  return [{ from: first, to: Math.max(first, last) }];
}

// Ctrl+D duplicates the selected lines below them
function duplicateLines(view: EditorView): boolean {
  const { state } = view;
  const [{ from, to }] = selectedLines(state);
  const block = Array.from({ length: to - from + 1 }, (_, k) => state.doc.line(from + k).text).join("\n");
  const insertAt = state.doc.line(to).to;
  const anchor = insertAt + 1 + (state.selection.main.head - state.doc.lineAt(state.selection.main.head).from);
  view.dispatch({
    changes: { from: insertAt, insert: "\n" + block },
    selection: EditorSelection.cursor(Math.min(anchor, insertAt + 1 + block.length)),
  });
  return true;
}

// Ctrl+/ toggles // on the selected lines
function toggleComment(view: EditorView): boolean {
  const { state } = view;
  const [{ from, to }] = selectedLines(state);
  const changes: ChangeSpec[] = [];
  for (let n = from; n <= to; n++) {
    const line = state.doc.line(n);
    const m = /^(\s*)\/\/ ?/.exec(line.text);
    if (m) changes.push({ from: line.from + m[1].length, to: line.from + m[0].length });
    else {
      const indent = /^\s*/.exec(line.text)?.[0] ?? "";
      changes.push({ from: line.from + indent.length, insert: "// " });
    }
  }
  if (!changes.length) return false;
  view.dispatch({ changes });
  return true;
}

// Ctrl+T inserts a total line below the cursor
function insertSubtotal(view: EditorView): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  view.dispatch({
    changes: { from: line.to, insert: "\ntotal" },
    selection: EditorSelection.cursor(line.to + "\ntotal".length),
  });
  return true;
}

// Ctrl+L asks for a line number and inserts a live lineN reference to it
function insertLineRef(view: EditorView): boolean {
  const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
  const { close, result } = showDialog(view, {
    label: "Reference line",
    input: { type: "text", name: "line", value: String(Math.max(1, cur - 1)) },
    focus: true,
    submitLabel: "go",
  });
  void result.then((form) => {
    const input = form?.elements.namedItem("line");
    const n = parseInt(input instanceof HTMLInputElement ? input.value : "", 10);
    if (!Number.isInteger(n)) {
      view.dispatch({ effects: close });
      return;
    }
    const target = Math.max(1, Math.min(view.state.doc.lines, n));
    if (target >= view.state.doc.lineAt(view.state.selection.main.head).number) {
      view.dispatch({ effects: close }); // references only reach upward
      return;
    }
    const sel = view.state.selection.main;
    view.dispatch({
      changes: { from: sel.from, to: sel.to, insert: `line${target}` },
      effects: close,
    });
    view.focus();
  });
  return true;
}

// drag an answer onto another answer to move its line below that line
function moveLineTo(view: EditorView, fromLine: number, toLine: number): boolean {
  const doc = view.state.doc;
  if (fromLine < 1 || fromLine > doc.lines || toLine < 1 || toLine > doc.lines || fromLine === toLine) return false;
  const src = doc.line(fromLine).text;
  const delFrom = fromLine < doc.lines ? doc.line(fromLine).from : doc.line(fromLine - 1).to;
  const delTo = fromLine < doc.lines ? doc.line(fromLine + 1).from : doc.line(fromLine).to;
  const changes: ChangeSpec[] =
    fromLine < toLine
      ? [
          { from: delFrom, to: delTo },
          { from: doc.line(toLine).to, insert: "\n" + src },
        ]
      : [
          { from: doc.line(toLine).from, insert: src + "\n" },
          { from: delFrom, to: delTo },
        ];
  view.dispatch({ changes });
  const anchor = Math.min(toLine, view.state.doc.lines);
  view.dispatch({ selection: EditorSelection.cursor(view.state.doc.line(anchor).from) });
  return true;
}

// ---------------------------------------------------------------------------
// variable completion, rename, and use highlighting
// ---------------------------------------------------------------------------

// complete variable names defined above the cursor; multi-word names apply
// cleanly when the head already precedes the word being typed
function varCompletions(context: CompletionContext) {
  const word = context.matchBefore(/\w+/);
  if (!word && !context.explicit) return null;
  const typed = word ? word.text : "";
  const doc = context.state.doc;
  const curLine = doc.lineAt(context.pos).number;
  const vars = collectVariables(doc.toString(), curLine);
  const options = vars
    .filter((v) => !typed || v === typed || v.startsWith(typed) || v.endsWith(` ${typed}`) || v.includes(` ${typed} `))
    .map((v) => ({
      label: v,
      type: "variable",
      apply: (view: EditorView, _completion: Completion, from: number, to: number) => {
        let start = from;
        const head = typed && v.endsWith(` ${typed}`) ? v.slice(0, v.length - typed.length) : "";
        if (head) {
          const line = view.state.doc.lineAt(from);
          const before = line.text.slice(0, from - line.from);
          if (before.toLowerCase().endsWith(head.toLowerCase())) start = from - head.length;
        }
        view.dispatch({
          changes: { from: start, to, insert: v },
          selection: EditorSelection.cursor(start + v.length),
        });
      },
    }));
  if (!options.length) return null;
  return { from: word ? word.from : context.pos, options, validFor: /^\w*$/ };
}

// F2 renames the variable under the cursor everywhere, in a single undo step
function renameVarAtCursor(view: EditorView): boolean {
  const { state } = view;
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  const name = variableAt(state.doc.toString(), line.number, head - line.from);
  if (!name) return false;
  const { close, result } = showDialog(view, {
    label: `Rename ${name} to`,
    input: { type: "text", name: "name", value: name },
    focus: true,
    submitLabel: "rename",
  });
  void result.then((form) => {
    const input = form?.elements.namedItem("name");
    const next = input instanceof HTMLInputElement ? input.value.trim() : "";
    view.dispatch({ effects: close });
    if (!next || next.toLowerCase() === name) return;
    const text = view.state.doc.toString();
    const renamed = renameVariable(text, name, next);
    if (renamed === text) return;
    view.dispatch({ changes: { from: 0, to: text.length, insert: renamed } });
    view.focus();
  });
  return true;
}

// the variable under the cursor, for use highlighting (null when none)
const varUseField = StateField.define<string | null>({
  create: (s) => {
    if (!s.selection.main.empty) return null;
    const head = s.selection.main.head;
    const line = s.doc.lineAt(head);
    return variableAt(s.doc.toString(), line.number, head - line.from);
  },
  update: (v, tr) => {
    if (!tr.docChanged && !tr.selection) return v;
    const s = tr.state;
    if (!s.selection.main.empty) return null;
    const head = s.selection.main.head;
    const line = s.doc.lineAt(head);
    return variableAt(s.doc.toString(), line.number, head - line.from);
  },
});

function varUseDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const name = state.field(varUseField, false);
  if (!name) return builder.finish();
  for (const r of variableUses(state.doc.toString(), name)) {
    builder.add(r.from, r.to, Decoration.mark({ class: "ck-var-use" }));
  }
  return builder.finish();
}

// reference insertion helpers
// ---------------------------------------------------------------------------

function insertRef(view: EditorView, sourceLine: number): boolean {
  const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
  if (cur <= sourceLine) return false; // references only reach upward
  view.dispatch(view.state.replaceSelection(`line${sourceLine}`));
  view.focus();
  return true;
}

function nearestValuedLineAbove(view: EditorView, before: number): number | null {
  const sheet = view.state.field(sheetField);
  for (let n = before - 1; n >= 1; n--) {
    if (sheet.lines[n - 1]?.formatted) return n;
  }
  return null;
}

// typing an operator on an empty line references the previous answer, Soulver-style
const operatorAutoRef = EditorView.inputHandler.of((view, from, to, text) => {
  if (text.length !== 1 || !"+*/×÷^".includes(text)) return false;
  const line = view.state.doc.lineAt(from);
  if (from !== line.from || to !== from || line.length !== 0) return false;
  const n = nearestValuedLineAbove(view, line.number);
  if (!n) return false;
  const insert = `line${n} ${text} `;
  view.dispatch({ changes: { from, insert }, selection: { anchor: from + insert.length }, userEvent: "input.type" });
  return true;
});

// ---------------------------------------------------------------------------
// scrubbable numbers: Alt+drag a number sideways (or Alt+scroll) to change it live
// ---------------------------------------------------------------------------

interface ScrubTarget {
  from: number;
  to: number;
  text: string;
}

const SCRUB_RE = /^\d[\d,]*(\.\d+)?$/; // plain decimals only; hex, 1e3 and underscores stay hands-off

function findScrubTarget(view: EditorView, pos: number): ScrubTarget | null {
  const sheet = view.state.field(sheetField);
  const line = view.state.doc.lineAt(pos);
  const sems = sheet.lines[line.number - 1]?.sem ?? [];
  for (const t of sems) {
    if (t.type !== "number" || pos < t.from || pos > t.to) continue;
    const text = view.state.doc.sliceString(t.from, t.to);
    if (!SCRUB_RE.test(text)) return null;
    return { from: t.from, to: t.to, text };
  }
  return null;
}

const groupInt = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function scrubbing(): Extension {
  interface Session {
    from: number;
    len: number;
    originalText: string;
    base: Decimal;
    step: Decimal;
    decimals: number;
    grouped: boolean;
    steps: number;
  }
  let session: Session | null = null;
  let wheelTimer: ReturnType<typeof setTimeout> | undefined;

  const begin = (t: ScrubTarget) => {
    const decimals = t.text.includes(".") ? t.text.split(".")[1].length : 0;
    session = {
      from: t.from,
      len: t.to - t.from,
      originalText: t.text,
      base: new Decimal(t.text.replace(/,/g, "")),
      step: new Decimal(1).div(Decimal.pow(10, decimals)),
      decimals,
      grouped: t.text.includes(","),
      steps: 0,
    };
  };

  const apply = (view: EditorView, steps: number) => {
    if (!session || steps === session.steps) return;
    session.steps = steps;
    const value = session.base.plus(session.step.mul(steps));
    let text = value.toFixed(session.decimals);
    if (session.grouped) {
      const [int, frac] = text.split(".");
      text = groupInt(int) + (frac !== undefined ? "." + frac : "");
    }
    view.dispatch({
      changes: { from: session.from, to: session.from + session.len, insert: text },
      annotations: Transaction.addToHistory.of(false),
    });
    session.len = text.length;
  };

  // collapse the whole scrub into one undo step: silently revert, then re-apply on the record
  const commit = (view: EditorView) => {
    if (!session) return;
    const { from, len, originalText, steps } = session;
    const finalText = view.state.doc.sliceString(from, from + len);
    session = null;
    if (steps === 0 || finalText === originalText) return;
    view.dispatch({ changes: { from, to: from + len, insert: originalText }, annotations: Transaction.addToHistory.of(false) });
    view.dispatch({ changes: { from, to: from + originalText.length, insert: finalText } });
  };

  return EditorView.domEventHandlers({
    mousedown: (e, view) => {
      if (!e.altKey || e.button !== 0) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const t = findScrubTarget(view, pos);
      if (!t) return false;
      commit(view);
      begin(t);
      const startX = e.clientX;
      const move = (me: MouseEvent) => apply(view, Math.round((me.clientX - startX) / 6));
      const up = () => {
        window.removeEventListener("mousemove", move);
        commit(view);
      };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up, { once: true });
      e.preventDefault();
      return true;
    },
    wheel: (e, view) => {
      if (!e.altKey) return false;
      const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
      if (pos === null) return false;
      const inSession = session && pos >= session.from && pos <= session.from + session.len;
      if (!inSession) {
        commit(view);
        const t = findScrubTarget(view, pos);
        if (!t) return false;
        begin(t);
      }
      apply(view, session!.steps + (e.deltaY < 0 ? 1 : -1));
      clearTimeout(wheelTimer);
      wheelTimer = setTimeout(() => commit(view), 600);
      e.preventDefault();
      return true;
    },
    keydown: (e, view) => {
      if (e.key === "Alt") view.dom.classList.add("ck-alt");
      return false;
    },
    keyup: (e, view) => {
      if (e.key === "Alt") view.dom.classList.remove("ck-alt");
      return false;
    },
    blur: (_e, view) => {
      view.dom.classList.remove("ck-alt");
      return false;
    },
  });
}

// ---------------------------------------------------------------------------
// answers column
// ---------------------------------------------------------------------------

interface Row {
  top: number;
  text: string;
  line: string;
  kind: string;
  lineNo: number;
}

const answers = ViewPlugin.fromClass(
  class {
    container: HTMLDivElement;

    constructor(readonly view: EditorView) {
      this.container = document.createElement("div");
      this.container.className = "ck-answers";
      view.scrollDOM.appendChild(this.container);
      this.schedule();
    }

    update(u: ViewUpdate) {
      // the search panel pushes content down, so answers re-measure with it too
      const panelNow = searchPanelOpen(u.state);
      const panelBefore = searchPanelOpen(u.startState);
      if (u.docChanged || u.viewportChanged || u.geometryChanged || panelNow !== panelBefore || u.transactions.some((tr) => tr.effects.some((e) => e.is(recalc)))) {
        this.schedule();
      }
    }

    schedule() {
      this.view.requestMeasure({
        read: (view): Row[] => {
          const sheet = view.state.field(sheetField);
          const rect = view.scrollDOM.getBoundingClientRect();
          const baseTop = view.documentTop - rect.top + view.scrollDOM.scrollTop;
          const rows: Row[] = [];
          for (const block of view.viewportLineBlocks) {
            const lineNo = view.state.doc.lineAt(block.from).number;
            const out = sheet.lines[lineNo - 1];
            if (!out || !out.formatted) continue;
            rows.push({ top: baseTop + block.top, text: out.formatted, line: view.state.doc.lineAt(block.from).text, kind: out.kind, lineNo });
          }
          return rows;
        },
        write: (rows: Row[]) => {
          const c = this.container;
          const view = this.view;
          c.textContent = "";
          for (const r of rows) {
            const el = document.createElement("div");
            el.className = "ck-answer" + (r.kind === "aggregate" ? " ck-answer-total" : "") + (r.kind === "assign" ? " ck-answer-var" : "");
            el.style.top = `${r.top}px`;
            el.textContent = r.text;
            el.title = "Click to copy · Shift+click copies the line · Alt+click copies plain · double-click to insert a reference · drag into a line";
            el.draggable = true;
            el.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
            el.addEventListener("dragstart", (e) => {
              e.dataTransfer?.setData("text/plain", `line${r.lineNo}`);
              e.dataTransfer?.setData("text/sourceline", String(r.lineNo));
            });
            // dropping an answer here moves its line below this one (tokens renumber after)
            el.addEventListener("dragover", (e) => e.preventDefault());
            el.addEventListener("drop", (e) => {
              e.preventDefault();
              e.stopPropagation();
              const src = parseInt(e.dataTransfer?.getData("text/sourceline") ?? "", 10);
              if (Number.isInteger(src)) moveLineTo(view, src, r.lineNo);
            });
            let copyTimer: ReturnType<typeof setTimeout> | undefined;
            el.addEventListener("click", (e) => {
              clearTimeout(copyTimer);
              const { shiftKey, altKey } = e;
              copyTimer = setTimeout(() => {
                const text = shiftKey ? copyLineText(r.line, r.text) : altKey ? plainAnswer(r.text) : r.text;
                navigator.clipboard.writeText(text).catch(() => {});
                el.classList.add("ck-copied");
                setTimeout(() => el.classList.remove("ck-copied"), 500);
              }, 260);
            });
            el.addEventListener("dblclick", () => {
              clearTimeout(copyTimer);
              if (!insertRef(view, r.lineNo)) {
                el.classList.add("ck-ref-denied");
                setTimeout(() => el.classList.remove("ck-ref-denied"), 450);
              }
            });
            c.appendChild(el);
          }
        },
      });
    }

    destroy() {
      this.container.remove();
    }
  },
);

const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "15px", backgroundColor: "transparent" },
  ".cm-scroller": {
    position: "relative",
    fontFamily: "var(--font)",
    lineHeight: "1.75",
    paddingBottom: "35vh",
  },
  ".cm-content": {
    paddingTop: "16px",
    paddingLeft: "20px",
    paddingRight: "224px",
    caretColor: "var(--accent)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
  ".cm-selectionBackground": { backgroundColor: "var(--sel) !important" },
  ".cm-activeLine": { backgroundColor: "var(--active-line)" },
});

export interface EditorHandle {
  view: EditorView;
  refresh(): void;
  destroy(): void;
  setDoc(text: string, docId: string): void;
  getDoc(): string;
}

export function createEditor(
  parent: HTMLElement,
  doc: string,
  docId: string,
  onSheet: (s: SheetOut) => void,
  onSave: (docId: string, text: string) => void,
): EditorHandle {
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let currentDocId = docId; // saves are tagged with the sheet they belong to, so a pending save can never land on the wrong sheet

  const extensions = [
    history(),
    drawSelection(),
    highlightActiveLine(),
    EditorView.lineWrapping,
    keymap.of([
      { key: "Ctrl-g", run: gotoLine, preventDefault: true },
      { key: "Mod-h", run: openReplacePanel, preventDefault: true },
      // Mod-d is duplicate-line here, not the search panel's select-next
      ...searchKeymap.filter((b) => b.key !== "Mod-d"),
      ...completionKeymap,
      { key: "Mod-d", run: duplicateLines, preventDefault: true },
      { key: "Mod-/", run: toggleComment, preventDefault: true },
      { key: "Mod-t", run: insertSubtotal, preventDefault: true },
      { key: "Mod-l", run: insertLineRef, preventDefault: true },
      { key: "F2", run: renameVarAtCursor },
      { key: "Mod-r", run: renameVarAtCursor, preventDefault: true },
      { key: "Ctrl-Space", run: startCompletion },
      {
        key: "Ctrl-\\",
        run: (view) => {
          const cur = view.state.doc.lineAt(view.state.selection.main.head).number;
          const n = nearestValuedLineAbove(view, cur);
          if (!n) return false;
          view.dispatch(view.state.replaceSelection(`line${n}`));
          return true;
        },
      },
      ...defaultKeymap,
      ...historyKeymap,
    ]),
    sheetField,
    refRenumber,
    operatorAutoRef,
    scrubbing(),
    highlightSelectionMatches(),
    autocompletion({ override: [varCompletions] }),
    varUseField,
    EditorView.decorations.compute([varUseField], (s) => varUseDecos(s)),
    EditorView.decorations.compute([sheetField], (s) => getDecos(s).marks),
    EditorView.decorations.compute([sheetField], (s) => getDecos(s).refs),
    EditorView.atomicRanges.of((view) => getDecos(view.state).refs),
    answers,
    theme,
    EditorView.updateListener.of((u) => {
      if (u.docChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(recalc)))) {
        onSheet(u.state.field(sheetField));
      }
      if (u.docChanged) {
        const id = currentDocId;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => onSave(id, u.state.doc.toString()), 300);
      }
    }),
  ];

  const makeState = (text: string) => EditorState.create({ doc: text, extensions });
  const view = new EditorView({ parent, state: makeState(doc) });

  onSheet(view.state.field(sheetField));
  view.focus();
  if (import.meta.env.DEV) (window as unknown as { __cmView: EditorView }).__cmView = view;

  return {
    view,
    refresh: () => view.dispatch({ effects: recalc.of(null) }),
    destroy: () => {
      clearTimeout(saveTimer);
      view.destroy();
    },
    setDoc: (text, id) => {
      clearTimeout(saveTimer); // the caller stashes the outgoing doc itself
      currentDocId = id;
      view.setState(makeState(text));
      onSheet(view.state.field(sheetField));
      view.focus();
    },
    getDoc: () => view.state.doc.toString(),
  };
}
