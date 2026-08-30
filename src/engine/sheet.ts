import { classify, parseSig, normalizeVarName, SemTok, Env } from "./parse";
import { tokenize } from "./tokenize";
import { evalNode, addValues } from "./evaluate";
import { formatValue } from "./format";
import { Value, CalcError, Decimal } from "./value";

export type { SemTok } from "./parse";

export type LineKind = "empty" | "heading" | "comment" | "normal" | "assign" | "aggregate";

export interface LineOut {
  kind: LineKind;
  value: Value | null;
  formatted: string;
  sem: SemTok[];
}

export interface SheetOut {
  lines: LineOut[];
  total: Value | null;
  totalFormatted: string;
}

interface Masked {
  masked: string;
  spans: { from: number; to: number }[];
}

function maskComments(line: string): Masked {
  const spans: { from: number; to: number }[] = [];

  // "quoted text" is commentary; a quote glued to a digit is an inch mark (3' 4"), not a quote
  const quoteRe = /(?<!\d)"[^"]*"/g;
  let m: RegExpExecArray | null;
  while ((m = quoteRe.exec(line))) spans.push({ from: m.index, to: m.index + m[0].length });

  // // comment (but not ://), and a trailing " # note"
  let cut = -1;
  let p = 0;
  while (p < line.length) {
    const idx = line.indexOf("//", p);
    if (idx === -1) break;
    if (idx === 0 || line[idx - 1] !== ":") {
      cut = idx;
      break;
    }
    p = idx + 2;
  }
  const hash = line.search(/[ \t]#/);
  if (hash !== -1 && (cut === -1 || hash + 1 < cut)) cut = hash + 1;
  if (cut !== -1) spans.push({ from: cut, to: line.length });

  let masked = line;
  for (const s of spans) masked = masked.slice(0, s.from) + " ".repeat(s.to - s.from) + masked.slice(s.to);
  return { masked, spans };
}

function fold(values: Value[]): Value | null {
  // values arrive bottom-up; the bottom-most compatible run wins
  let acc: Value | null = null;
  for (const v of values) {
    if (v.kind === "percent" || v.kind === "date" || v.kind === "time") continue;
    if (acc === null) {
      acc = v;
      continue;
    }
    try {
      acc = addValues(v, acc); // above-line on the left so mixed currencies keep the bottom line's unit
    } catch {
      break;
    }
  }
  return acc;
}

function windowAggregate(name: string, out: LineOut[]): Value | null {
  const collected: Value[] = [];
  for (let j = out.length - 1; j >= 0; j--) {
    const l = out[j];
    if (l.kind === "empty" || l.kind === "heading" || l.kind === "aggregate") break;
    if (l.value) collected.push(l.value);
  }
  const usable = collected.filter((v) => v.kind !== "percent" && v.kind !== "date" && v.kind !== "time");
  if (!usable.length) return null;
  try {
    switch (name) {
      case "total":
      case "sum":
        return fold(usable);
      case "count":
        return { kind: "number", d: new Decimal(usable.length) };
      case "average": {
        const s = fold(usable);
        if (!s) return null;
        return { ...s, d: s.d.div(usable.length) };
      }
      case "median": {
        const sorted = [...usable].sort((a, b) => a.d.cmp(b.d));
        const mid = Math.floor(sorted.length / 2);
        if (sorted.length % 2 === 1) return sorted[mid];
        const s = addValues(sorted[mid - 1], sorted[mid]);
        return { ...s, d: s.d.div(2) };
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function evaluateSheet(text: string): SheetOut {
  const rawLines = text.split("\n");
  const env: Env = { vars: new Map(), lineValues: [] };
  const out: LineOut[] = [];
  let off = 0;

  for (const raw of rawLines) {
    const sem: SemTok[] = [];
    const finish = (kind: LineKind, value: Value | null) => {
      let formatted = "";
      if (value) {
        try {
          formatted = formatValue(value);
        } catch {
          value = null;
        }
      }
      out.push({ kind, value, formatted, sem });
      env.lineValues.push(value);
      off += raw.length + 1;
    };

    if (raw.trim() === "") {
      finish("empty", null);
      continue;
    }

    // heading
    if (/^\s*#/.test(raw)) {
      const s = raw.length - raw.trimStart().length;
      sem.push({ from: off + s, to: off + raw.trimEnd().length, type: "heading" });
      finish("heading", null);
      continue;
    }

    const { masked, spans } = maskComments(raw);
    for (const s of spans) sem.push({ from: off + s.from, to: off + s.to, type: "comment" });
    if (masked.trim() === "") {
      finish("comment", null);
      continue;
    }

    // label: "flights: $420 × 2"
    let body = masked;
    const label = /^(\s*)([A-Za-z][A-Za-z0-9 _.'-]*):(?=\s|$)/.exec(masked);
    if (label) {
      const from = label[1].length;
      const to = label[0].length;
      sem.push({ from: off + from, to: off + to, type: "label" });
      body = " ".repeat(to) + masked.slice(to);
      if (body.trim() === "") {
        finish("normal", null);
        continue;
      }
    }

    // assignment: "monthly rent = $1,450"
    const toks = tokenize(body);
    let eq = -1;
    let depth = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === "lp") depth++;
      else if (t.t === "rp") depth--;
      else if (t.t === "op" && t.op === "=" && depth === 0) {
        if (i > 0 && toks.slice(0, i).every((w) => w.t === "word")) eq = i;
        break;
      }
    }
    if (eq > 0) {
      const eqTok = toks[eq];
      const nameFrom = toks[0].from;
      const nameTo = toks[eq - 1].to;
      const name = normalizeVarName(body.slice(nameFrom, nameTo));
      sem.push({ from: off + nameFrom, to: off + nameTo, type: "variable" });
      const rhsBase = eqTok.to;
      const { sig, sem: rhsSem } = classify(body.slice(rhsBase), env, off + rhsBase);
      sem.push(...rhsSem);
      const parsed = parseSig(sig);
      let value: Value | null = null;
      if (parsed?.kind === "expr") {
        try {
          value = evalNode(parsed.node, env);
        } catch (e) {
          if (!(e instanceof CalcError)) throw e;
        }
      } else if (parsed?.kind === "agg") {
        value = windowAggregate(parsed.name, out);
      }
      if (value) env.vars.set(name, value);
      finish("assign", value);
      continue;
    }

    // regular line
    const { sig, sem: exprSem } = classify(body, env, off);
    sem.push(...exprSem);
    const parsed = parseSig(sig);
    if (!parsed) {
      finish("normal", null);
      continue;
    }
    if (parsed.kind === "agg") {
      finish("aggregate", windowAggregate(parsed.name, out));
      continue;
    }
    let value: Value | null = null;
    try {
      value = evalNode(parsed.node, env);
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
    }
    finish("normal", value);
  }

  // quick total (bottom-right): totals if any exist, otherwise all plain result lines
  const aggs = out.filter((l) => l.kind === "aggregate" && l.value).map((l) => l.value!);
  const normals = out.filter((l) => l.kind === "normal" && l.value).map((l) => l.value!);
  const pool = (aggs.length ? aggs : normals).reverse();
  const total = fold(pool);
  let totalFormatted = "";
  if (total) {
    try {
      totalFormatted = formatValue(total);
    } catch {
      /* leave empty */
    }
  }
  return { lines: out, total, totalFormatted };
}
