import { classify, parseSig, normalizeVarName, SemTok, Env, Sig } from "./parse";
import { tokenize } from "./tokenize";
import { evalNode, addValues, baseKey, binop } from "./evaluate";
import { formatValue } from "./format";
import { Value, CalcError, Decimal } from "./value";

export type { SemTok } from "./parse";

export type LineKind = "empty" | "heading" | "comment" | "divider" | "normal" | "assign" | "aggregate";

export interface LineOut {
  kind: LineKind;
  value: Value | null;
  formatted: string;
  sem: SemTok[];
  tags: string[];
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

  // // comment (but not ://), and a trailing " # note" ("#tag" stays math)
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
  const hashRe = /[ \t]#/g;
  let hm: RegExpExecArray | null;
  while ((hm = hashRe.exec(line))) {
    const after = line[hm.index + 2];
    if (after !== undefined && /[A-Za-z]/.test(after)) continue; // #tag, not a comment
    const c = hm.index + 1;
    if (cut === -1 || c < cut) cut = c;
  }
  if (cut !== -1) spans.push({ from: cut, to: line.length });

  let masked = line;
  for (const s of spans) masked = masked.slice(0, s.from) + " ".repeat(s.to - s.from) + masked.slice(s.to);
  return { masked, spans };
}

function fold(values: Value[]): Value | null {
  // values arrive bottom-up; the bottom-most compatible run wins
  let acc: Value | null = null;
  for (const v of values) {
    if (v.kind === "percent" || v.kind === "date" || v.kind === "time" || v.kind === "bool") continue;
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
    if (l.kind === "empty" || l.kind === "heading" || l.kind === "divider" || l.kind === "aggregate") break;
    if (l.value) collected.push(l.value);
  }
  const usable = collected.filter((v) => v.kind !== "percent" && v.kind !== "date" && v.kind !== "time" && v.kind !== "bool");
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
      case "min":
      case "max": {
        let best = usable[0];
        for (const v of usable.slice(1)) {
          const better = name === "max" ? baseKey(v).gt(baseKey(best)) : baseKey(v).lt(baseKey(best));
          if (better) best = v;
        }
        return best;
      }
    }
  } catch {
    return null;
  }
  return null;
}

// A line holding nothing but a percent ("10%", "tip 10%") applies to the running
// subtotal above it: the tax/tip pattern. No subtotal above means a plain percent.
function isBarePercent(sig: Sig[]): boolean {
  const core = sig.filter((t) => t.s !== "tag");
  const pct = (t: Sig | undefined): boolean => !!t && t.s === "op" && (t as Extract<Sig, { s: "op" }>).op === "%";
  if (core.length === 2 && core[0].s === "num" && pct(core[1])) return true;
  if (core.length === 3 && core[0].s === "op" && core[1].s === "num" && pct(core[2])) return true;
  return false;
}

function blockSubtotal(out: LineOut[]): Value | null {
  const collected: Value[] = [];
  for (let j = out.length - 1; j >= 0; j--) {
    const l = out[j];
    if (l.kind === "empty" || l.kind === "heading" || l.kind === "divider" || l.kind === "aggregate") break;
    if (l.value) collected.push(l.value);
  }
  const usable = collected.filter((v) => v.kind !== "percent" && v.kind !== "date" && v.kind !== "time" && v.kind !== "bool");
  if (!usable.length) return null;
  try {
    return fold(usable);
  } catch {
    return null;
  }
}

// Tagged aggregate: "total of #work" folds only tagged lines in the block.
function taggedAggregate(name: string, tag: string, out: LineOut[]): Value | null {
  const collected: Value[] = [];
  for (let j = out.length - 1; j >= 0; j--) {
    const l = out[j];
    if (l.kind === "empty" || l.kind === "heading" || l.kind === "divider" || l.kind === "aggregate") break;
    if (l.value && l.tags.includes(tag)) collected.push(l.value);
  }
  const usable = collected.filter((v) => v.kind !== "percent" && v.kind !== "date" && v.kind !== "time" && v.kind !== "bool");
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
      case "min":
      case "max": {
        let best = usable[0];
        for (const v of usable.slice(1)) {
          const better = name === "max" ? baseKey(v).gt(baseKey(best)) : baseKey(v).lt(baseKey(best));
          if (better) best = v;
        }
        return best;
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
    const finish = (kind: LineKind, value: Value | null, tags: string[] = []) => {
      let formatted = "";
      if (value) {
        try {
          formatted = formatValue(value);
        } catch {
          value = null;
        }
      }
      out.push({ kind, value, formatted, sem, tags });
      env.lineValues.push(value);
      off += raw.length + 1;
    };

    if (raw.trim() === "") {
      finish("empty", null);
      continue;
    }

    // heading ("# groceries"); "#tag" without a space stays math
    if (/^\s*#(\s|$)/.test(raw)) {
      const s = raw.length - raw.trimStart().length;
      sem.push({ from: off + s, to: off + raw.trimEnd().length, type: "heading" });
      finish("heading", null);
      continue;
    }

    // divider ("---"); shows no answer and resets total scope like a heading
    if (/^\s*---+\s*$/.test(raw)) {
      finish("divider", null);
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
    let eqLead = 0; // "1 watermelon = 20 lb" defines a custom unit; the leading 1 is dropped
    let depth = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === "lp") depth++;
      else if (t.t === "rp") depth--;
      else if (t.t === "op" && t.op === "=" && depth === 0) {
        const first = toks[0];
        const lead = first?.t === "num" && first.d.eq(1) ? 1 : 0;
        if (i > lead && toks.slice(lead, i).every((w) => w.t === "word")) {
          eq = i;
          eqLead = lead;
        }
        break;
      }
    }
    if (eq > 0) {
      const eqTok = toks[eq];
      const nameFrom = toks[eqLead].from;
      const nameTo = toks[eq - 1].to;
      const name = normalizeVarName(body.slice(nameFrom, nameTo));
      sem.push({ from: off + nameFrom, to: off + nameTo, type: "variable" });
      const rhsBase = eqTok.to;
      const { sig, sem: rhsSem } = classify(body.slice(rhsBase), env, off + rhsBase);
      sem.push(...rhsSem);
      const parsed = parseSig(sig);
      const rhsTags = sig.filter((t): t is Extract<Sig, { s: "tag" }> => t.s === "tag").map((t) => t.tag);
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
      finish("assign", value, rhsTags);
      continue;
    }

    // compound assignment: "x += 5" adds to the last value of x above (silent when unset)
    if (eq <= 0) {
      let ceq = -1;
      let cop: "+" | "-" | null = null;
      let clead = 0;
      let cdepth = 0;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i];
        if (t.t === "lp") cdepth++;
        else if (t.t === "rp") cdepth--;
        else if (t.t === "op" && (t.op === "+" || t.op === "-") && cdepth === 0) {
          const nx = toks[i + 1];
          if (nx?.t === "op" && nx.op === "=") {
            const first = toks[0];
            const lead = first?.t === "num" && first.d.eq(1) ? 1 : 0;
            if (i > lead && toks.slice(lead, i).every((w) => w.t === "word")) {
              ceq = i;
              cop = t.op as "+" | "-";
              clead = lead;
            }
            break;
          }
        }
      }
      if (ceq > 0 && cop) {
        const nameFrom = toks[clead].from;
        const nameTo = toks[ceq - 1].to;
        const name = normalizeVarName(body.slice(nameFrom, nameTo));
        sem.push({ from: off + nameFrom, to: off + nameTo, type: "variable" });
        const rhsBase = toks[ceq + 1].to;
        const { sig, sem: rhsSem } = classify(body.slice(rhsBase), env, off + rhsBase);
        sem.push(...rhsSem);
        const parsed = parseSig(sig);
        const rhsTags = sig.filter((t): t is Extract<Sig, { s: "tag" }> => t.s === "tag").map((t) => t.tag);
        let value: Value | null = null;
        const old = env.vars.get(name);
        if (parsed?.kind === "expr" && old) {
          try {
            const delta = evalNode(parsed.node, env);
            value = cop === "+" ? addValues(old, delta) : binop("-", old, delta);
          } catch (e) {
            if (!(e instanceof CalcError)) throw e;
          }
        }
        if (value) env.vars.set(name, value);
        finish("assign", value, rhsTags);
        continue;
      }
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
    if (parsed.kind === "tagged") {
      finish("aggregate", taggedAggregate(parsed.name, parsed.tag, out));
      continue;
    }
    let value: Value | null = null;
    try {
      value = evalNode(parsed.node, env);
    } catch (e) {
      if (!(e instanceof CalcError)) throw e;
    }
    // bare percent lines apply to the block subtotal above ("tip 10%" after dinner lines)
    if (value?.kind === "percent" && isBarePercent(sig)) {
      const sub = blockSubtotal(out);
      if (sub) {
        try {
          value = binop("of", value, sub);
        } catch {
          /* keep the plain percent */
        }
      }
    }
    const tags = sig.filter((t): t is Extract<Sig, { s: "tag" }> => t.s === "tag").map((t) => t.tag);
    finish("normal", value, tags);
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

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Pure rename of a variable across sheet text: whole-word matches outside comments
// and quoted strings become newName. The UI wires this to F2/Ctrl+R with one undo.
export function renameVariable(text: string, oldName: string, newName: string): string {
  const from = normalizeVarName(oldName);
  const to = newName.trim();
  if (!from || !to || from === normalizeVarName(to)) return text;
  const re = new RegExp(`(?<![A-Za-z0-9_])${from.split(" ").map(escapeRegExp).join("\\s+")}(?![A-Za-z0-9_])`, "gi");
  return text
    .split("\n")
    .map((raw) => {
      const { spans } = maskComments(raw);
      let out = "";
      let pos = 0;
      const sorted = [...spans].sort((a, b) => a.from - b.from);
      for (const s of sorted) {
        if (pos < s.from) out += raw.slice(pos, s.from).replace(re, to);
        out += raw.slice(s.from, s.to);
        pos = s.to;
      }
      if (pos < raw.length) out += raw.slice(pos).replace(re, to);
      return out;
    })
    .join("\n");
}
