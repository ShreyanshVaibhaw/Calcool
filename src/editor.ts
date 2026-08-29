import { EditorView, ViewPlugin, ViewUpdate, Decoration, DecorationSet, WidgetType, keymap, drawSelection, highlightActiveLine } from "@codemirror/view";
import { EditorState, StateField, StateEffect, RangeSetBuilder, MapMode, ChangeSpec, Transaction, Extension } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { evaluateSheet, SheetOut } from "./engine/sheet";
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
      if (u.docChanged || u.viewportChanged || u.geometryChanged || u.transactions.some((tr) => tr.effects.some((e) => e.is(recalc)))) {
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
            rows.push({ top: baseTop + block.top, text: out.formatted, kind: out.kind, lineNo });
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
            el.title = "Click to copy · double-click to insert a reference · drag into a line";
            el.draggable = true;
            el.addEventListener("mousedown", (e) => e.preventDefault()); // keep editor focus
            el.addEventListener("dragstart", (e) => {
              e.dataTransfer?.setData("text/plain", `line${r.lineNo}`);
            });
            let copyTimer: ReturnType<typeof setTimeout> | undefined;
            el.addEventListener("click", () => {
              clearTimeout(copyTimer);
              copyTimer = setTimeout(() => {
                navigator.clipboard.writeText(r.text).catch(() => {});
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
