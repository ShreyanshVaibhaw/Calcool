import { Decimal, Unit, Value, CalcError } from "./value";
import { tokenize } from "./tokenize";
import { lookupUnitWord, lookupTwoWord, lookupSubstance, currencyBySymbol } from "./units";
import { MONTHS, WDAYS, todayEpoch, toEpochDay, fromEpochDay, nearestWeekday, daysInMonth, holiday } from "./dates";
import { lookupZoneWord, lookupZonePair, localZone, wallToEpochMin, epochMinToWall, offsetMin } from "./times";
import { unitById } from "./units";
import { taxName } from "./tax";

export interface SemTok {
  from: number;
  to: number;
  type: string; // number | unit | currency | operator | keyword | function | variable | comment | heading | label | ref
  ref?: number; // 0-based line index a "lineN" token points at
}

export interface Env {
  vars: Map<string, Value>;
  lineValues: (Value | null)[];
}

export type Target =
  | { k: "unit"; unit: Unit; sub?: Unit } // sub: "in feet and inches" compound display
  | { k: "rate"; num: Unit; den: Unit }
  | { k: "fmt"; fmt: string }
  | { k: "dp"; n: number }
  | { k: "nearest"; m: Decimal }
  | { k: "zone"; zone: string };

export type Node =
  | { n: "value"; v: Value; bare?: boolean }
  | { n: "bin"; op: string; l: Node; r: Node }
  | { n: "neg"; c: Node }
  | { n: "fn"; name: string; args: Node[] }
  | { n: "convert"; c: Node; t: Target }
  | { n: "aspct"; form: "of" | "off" | "on"; x: Node; y: Node } // x is what % of y
  | { n: "what"; form: "of" | "off" | "on"; x: Node; p: Node } // x is p% of what
  | { n: "change"; a: Node; b: Node } // a to b as %
  | { n: "ref"; idx: number }
  | { n: "var"; name: string }
  | { n: "span"; a: Node; b: Node; unit?: Unit } // distance between two dates
  | { n: "wdname"; c: Node } // weekday of a date
  // finance: ci/interest = compound interest (freq = compounds per year), loan = amortized
  // repayment (freq = payments per year, total = whole-term sum), cagr = annualized return
  | { n: "fin"; op: "ci" | "interest" | "loan" | "cagr"; p: Node; years: Node; rate?: Node; ret?: Node; freq?: number; total?: boolean }
  // sales tax: add = "+ VAT", remove = "- VAT" (divides out included tax), portion = "VAT on"
  | { n: "tax"; mode: "add" | "remove" | "portion"; c: Node };

type Sig =
  | { s: "tax"; from: number; to: number } // the configured sales-tax word (VAT/GST)
  | { s: "subst"; dens: Decimal; from: number; to: number } // cooking substance (butter, flour...)
  | { s: "lap"; secs: Decimal; from: number; to: number } // laptime literal 03:04:05, a duration
  | { s: "num"; d: Decimal; base?: number; from: number; to: number }
  | { s: "unit"; unit: Unit; from: number; to: number }
  | { s: "aff"; w: string; from: number; to: number } // word glued onto a number: 3k, 10m, 16th
  | { s: "op"; op: string; spacedL: boolean; from: number; to: number }
  | { s: "kw"; kw: string; from: number; to: number }
  | { s: "fn"; name: string; from: number; to: number }
  | { s: "fmt"; fmt: string; from: number; to: number }
  | { s: "mult"; d: Decimal; from: number; to: number }
  | { s: "const"; d: Decimal; from: number; to: number }
  | { s: "var"; name: string; from: number; to: number }
  | { s: "ref"; idx: number; from: number; to: number }
  | { s: "month"; m: number; from: number; to: number }
  | { s: "wday"; w: number; from: number; to: number }
  | { s: "dateval"; ed: number; from: number; to: number }
  | { s: "wdfn"; from: number; to: number } // "weekday" / "day of the week"
  | { s: "clock"; mins: number; from: number; to: number } // 7:30, 4pm, noon (no date yet)
  | { s: "timeval"; epochMin: number; zone?: string; from: number; to: number } // anchored instant
  | { s: "zone"; zone: string; from: number; to: number }
  | { s: "ampm"; pm: boolean; from: number; to: number }
  | { s: "lp"; from: number; to: number }
  | { s: "rp"; from: number; to: number }
  | { s: "comma"; from: number; to: number };

const KWS = new Set([
  "of", "off", "on", "in", "to", "as", "into", "at", "per", "is", "what", "a", "an", "and", "mod", "nearest", "dp", "digits",
  "after", "before", "from", "since", "until", "till", "ago", "left", "between", "next", "last", "time",
  // finance phrases
  "interest", "compounding", "compounded", "repayment", "repayments", "payment", "payments", "over",
  "annual", "annually", "annualized", "yearly", "monthly", "weekly", "daily", "quarterly", "return", "invested", "returned",
]);
export const AGGS = new Set(["total", "sum", "average", "avg", "count", "median"]);
const FNS = new Set([
  "sqrt", "cbrt", "abs", "round", "ceil", "floor", "fact", "factorial", "ln", "log", "log2", "log10", "exp",
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "sind", "cosd", "tand", "min", "max",
]);
const FMTS = new Set(["hex", "hexadecimal", "binary", "bin", "octal", "oct", "decimal", "dec", "number", "num", "fraction", "percent", "percentage", "sci", "scientific", "pitch"]);
const PI = new Decimal("3.141592653589793238462643383279503");
const CONSTS: Record<string, Decimal> = {
  pi: PI,
  "π": PI,
  tau: PI.mul(2),
  phi: new Decimal("1.618033988749894848204586834365638"),
};
const MULTS: Record<string, Decimal> = {
  thousand: new Decimal(1e3),
  thousands: new Decimal(1e3),
  million: new Decimal(1e6),
  millions: new Decimal(1e6),
  billion: new Decimal(1e9),
  billions: new Decimal(1e9),
  trillion: new Decimal(1e12),
  trillions: new Decimal(1e12),
};
const WORD_OPS: Record<string, string> = { plus: "+", minus: "-", times: "*" };

export function normalizeVarName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// classification: raw tokens -> significant tokens (word skipping happens here)
// ---------------------------------------------------------------------------

export function classify(text: string, env: Env, base: number): { sig: Sig[]; sem: SemTok[] } {
  const raw = tokenize(text);
  const sig: Sig[] = [];
  const sem: SemTok[] = [];
  const parens: { sigIdx: number; semIdx: number; from: number; dropped: boolean }[] = [];

  const markDrop = () => {
    if (parens.length) parens[parens.length - 1].dropped = true;
  };
  const S = (t: Sig) => sig.push(t);
  const M = (from: number, to: number, type: string) => sem.push({ from: base + from, to: base + to, type });

  let i = 0;
  while (i < raw.length) {
    const t = raw[i];

    if (t.t === "num") {
      S({ s: "num", d: t.d, base: t.base, from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    if (t.t === "cur") {
      const u = currencyBySymbol(t.sym);
      if (u) {
        S({ s: "unit", unit: u, from: t.from, to: t.to });
        M(t.from, t.to, "currency");
      } else markDrop();
      i++;
      continue;
    }
    if (t.t === "lp") {
      parens.push({ sigIdx: sig.length, semIdx: sem.length, from: t.from, dropped: false });
      S({ s: "lp", from: t.from, to: t.to });
      i++;
      continue;
    }
    if (t.t === "rp") {
      S({ s: "rp", from: t.from, to: t.to });
      const p = parens.pop();
      if (p && p.dropped) {
        // a paren group containing commentary words is a comment: ($999 (for iPhone 16))
        sig.splice(p.sigIdx);
        sem.splice(p.semIdx);
        sem.push({ from: base + p.from, to: base + t.to, type: "comment" });
      }
      i++;
      continue;
    }
    if (t.t === "comma") {
      S({ s: "comma", from: t.from, to: t.to });
      i++;
      continue;
    }
    if (t.t === "op") {
      if (t.op === "=" || t.op === "==" || t.op === "!=" || t.op === ">=" || t.op === "<=" || t.op === "<" || t.op === ">") {
        // comparisons/assignments are handled upstream or dropped; "cmp" forces an expression boundary
        S({ s: "op", op: "cmp", spacedL: true, from: t.from, to: t.to });
        i++;
        continue;
      }
      S({ s: "op", op: t.op, spacedL: t.spacedL, from: t.from, to: t.to });
      if (t.op !== ":") M(t.from, t.to, "operator");
      i++;
      continue;
    }

    // words -------------------------------------------------------------
    if (t.t !== "word") {
      i++;
      continue;
    }
    const w = t.w;
    const lower = w.toLowerCase();
    const prev = raw[i - 1];

    // glued suffix: 3k, $5m, 10m, 16th, 4pm
    if (t.att && prev && prev.t === "num") {
      S({ s: "aff", w, from: t.from, to: t.to });
      if (/^(k|m|b|t|bn|tn|mn|g|am|pm)$/i.test(w) || lookupUnitWord(w)) M(t.from, t.to, lookupUnitWord(w) ? "unit" : "number");
      i++;
      continue;
    }

    if (lower === "am" || lower === "pm") {
      S({ s: "ampm", pm: lower === "pm", from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }

    // variables (longest multi-word match wins)
    if (env.vars.size) {
      let matched = 0;
      let name = "";
      let cand = "";
      let end = t.to;
      for (let k = 0; k < 4 && i + k < raw.length; k++) {
        const wt = raw[i + k];
        if (wt.t !== "word") break;
        cand = cand ? `${cand} ${wt.w.toLowerCase()}` : wt.w.toLowerCase();
        if (env.vars.has(cand)) {
          matched = k + 1;
          name = cand;
          end = wt.to;
        }
      }
      if (!matched) {
        // plural fallback so "5 watermelons" finds the "watermelon" custom unit
        const single = lower.endsWith("es") && env.vars.has(lower.slice(0, -2)) ? lower.slice(0, -2) : lower.endsWith("s") && env.vars.has(lower.slice(0, -1)) ? lower.slice(0, -1) : null;
        if (single) {
          matched = 1;
          name = single;
          end = t.to;
        }
      }
      if (matched) {
        S({ s: "var", name, from: t.from, to: end });
        M(t.from, end, "variable");
        i += matched;
        continue;
      }
    }

    // multi-word merges
    const next = raw[i + 1];
    const nextW = next && next.t === "word" ? next.w : null;
    // "day of the week"
    if (lower === "day" && nextW?.toLowerCase() === "of") {
      const w3 = raw[i + 2];
      const w4 = raw[i + 3];
      if (w3?.t === "word" && w3.w.toLowerCase() === "the" && w4?.t === "word" && w4.w.toLowerCase() === "week") {
        S({ s: "wdfn", from: t.from, to: w4.to });
        M(t.from, w4.to, "keyword");
        i += 4;
        continue;
      }
    }
    if (nextW && `${lower} ${nextW.toLowerCase()}` === "new year") {
      S({ s: "dateval", ed: holiday("new year")!, from: t.from, to: next!.to });
      M(t.from, next!.to, "number");
      i += 2;
      continue;
    }
    if (nextW && lower === "time" && (nextW.toLowerCase() === "difference" || nextW.toLowerCase() === "diff")) {
      S({ s: "kw", kw: "timediff", from: t.from, to: next!.to });
      M(t.from, next!.to, "keyword");
      i += 2;
      continue;
    }
    if (nextW) {
      const zp = lookupZonePair(lower, nextW.toLowerCase());
      if (zp) {
        S({ s: "zone", zone: zp, from: t.from, to: next!.to });
        M(t.from, next!.to, "unit");
        i += 2;
        continue;
      }
    }
    if (nextW) {
      const pair = `${lower} ${nextW.toLowerCase()}`;
      if (pair === "square root" || pair === "cube root") {
        S({ s: "fn", name: pair === "square root" ? "sqrt" : "cbrt", from: t.from, to: next.to });
        M(t.from, next.to, "function");
        i += 2;
        continue;
      }
      if (pair === "per cent") {
        S({ s: "op", op: "%", spacedL: true, from: t.from, to: next.to });
        M(t.from, next.to, "operator");
        i += 2;
        continue;
      }
      if (pair === "multiplied by" || pair === "divided by") {
        S({ s: "op", op: pair === "multiplied by" ? "*" : "/", spacedL: true, from: t.from, to: next.to });
        M(t.from, next.to, "operator");
        i += 2;
        continue;
      }
      const u2 = lookupTwoWord(lower, nextW);
      if (u2) {
        S({ s: "unit", unit: u2, from: t.from, to: next.to });
        M(t.from, next.to, "unit");
        i += 2;
        continue;
      }
    }
    // "to the power of"
    if (lower === "to" && nextW?.toLowerCase() === "the") {
      const w3 = raw[i + 2];
      const w4 = raw[i + 3];
      if (w3?.t === "word" && w3.w.toLowerCase() === "power" && w4?.t === "word" && w4.w.toLowerCase() === "of") {
        S({ s: "op", op: "^", spacedL: true, from: t.from, to: w4.to });
        M(t.from, w4.to, "operator");
        i += 4;
        continue;
      }
    }

    if (WORD_OPS[lower]) {
      S({ s: "op", op: WORD_OPS[lower], spacedL: true, from: t.from, to: t.to });
      M(t.from, t.to, "operator");
      i++;
      continue;
    }
    const refMatch = /^line(\d+)$/.exec(lower);
    if (refMatch) {
      const idx = parseInt(refMatch[1], 10) - 1;
      S({ s: "ref", idx, from: t.from, to: t.to });
      sem.push({ from: base + t.from, to: base + t.to, type: "ref", ref: idx });
      i++;
      continue;
    }
    if (lower === taxName()) {
      S({ s: "tax", from: t.from, to: t.to });
      M(t.from, t.to, "keyword");
      i++;
      continue;
    }
    const dens = lookupSubstance(lower);
    if (dens) {
      S({ s: "subst", dens, from: t.from, to: t.to });
      M(t.from, t.to, "unit");
      i++;
      continue;
    }
    if (AGGS.has(lower) || KWS.has(lower)) {
      S({ s: "kw", kw: lower === "avg" ? "average" : lower, from: t.from, to: t.to });
      M(t.from, t.to, "keyword");
      i++;
      continue;
    }
    if (FMTS.has(lower)) {
      S({ s: "fmt", fmt: lower, from: t.from, to: t.to });
      M(t.from, t.to, "keyword");
      i++;
      continue;
    }
    if (FNS.has(lower)) {
      S({ s: "fn", name: lower === "factorial" ? "fact" : lower, from: t.from, to: t.to });
      M(t.from, t.to, "function");
      i++;
      continue;
    }
    if (CONSTS[lower]) {
      S({ s: "const", d: CONSTS[lower], from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    if (MULTS[lower]) {
      S({ s: "mult", d: MULTS[lower], from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    // date words (months come after the format keywords, so "dec"/"oct" stay numeric bases)
    if (lower === "today" || lower === "tomorrow" || lower === "yesterday") {
      const ed = todayEpoch() + (lower === "tomorrow" ? 1 : lower === "yesterday" ? -1 : 0);
      S({ s: "dateval", ed, from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    if (lower === "now") {
      S({ s: "timeval", epochMin: Math.round(Date.now() / 60000), from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    const hol = holiday(lower);
    if (hol !== null) {
      S({ s: "dateval", ed: hol, from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    if (lower === "weekday") {
      S({ s: "wdfn", from: t.from, to: t.to });
      M(t.from, t.to, "keyword");
      i++;
      continue;
    }
    if (MONTHS[lower] !== undefined) {
      S({ s: "month", m: MONTHS[lower], from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    if (WDAYS[lower] !== undefined) {
      S({ s: "wday", w: WDAYS[lower], from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    if (lower === "noon" || lower === "midday" || lower === "midnight") {
      S({ s: "clock", mins: lower === "midnight" ? 0 : 720, from: t.from, to: t.to });
      M(t.from, t.to, "number");
      i++;
      continue;
    }
    const zone = lookupZoneWord(w);
    if (zone) {
      S({ s: "zone", zone, from: t.from, to: t.to });
      M(t.from, t.to, "unit");
      i++;
      continue;
    }

    const u = lookupUnitWord(w);
    if (u) {
      S({ s: "unit", unit: u, from: t.from, to: t.to });
      M(t.from, t.to, u.category === "currency" ? "currency" : "unit");
      i++;
      continue;
    }

    // unknown word: this is the word skipping that makes the whole thing work
    markDrop();
    i++;
  }

  const isAmpmTok = (t: Sig | undefined): boolean => !!t && (t.s === "ampm" || (t.s === "aff" && /^(am|pm)$/i.test(t.w)));

  // laptimes: a full H:MM:SS triple is a duration (03:04:05 + 01:02:03), unless am/pm follows
  for (let k = 0; k < sig.length; k++) {
    const a = sig[k];
    const b = sig[k + 1];
    const c = sig[k + 2];
    const d1 = sig[k + 3];
    const e1 = sig[k + 4];
    if (a?.s !== "num" || !a.d.isInteger() || a.d.isNeg()) continue;
    if (!(b?.s === "op" && b.op === ":" && c?.s === "num" && c.d.isInteger())) continue;
    if (!(d1?.s === "op" && d1.op === ":" && e1?.s === "num")) continue;
    if (isAmpmTok(sig[k + 5])) continue; // 3:04:05 pm stays a clock time
    if (c.d.gte(60) || e1.d.gte(60)) continue;
    const secs = a.d.mul(3600).plus(c.d.mul(60)).plus(e1.d);
    sig.splice(k, 5, { s: "lap", secs, from: a.from, to: e1.to });
    M(a.from, e1.to, "number");
  }

  // clock literals: 7:30 / 16:00 / 3pm / 7:30 pm (a trailing :seconds group is dropped)
  const ampmIsPm = (t: Sig): boolean => (t.s === "ampm" ? t.pm : t.s === "aff" && t.w.toLowerCase() === "pm");
  for (let k = 0; k < sig.length; k++) {
    const a = sig[k];
    if (a?.s !== "num" || !a.d.isInteger()) continue;
    let mins = -1;
    let len = 0;
    const b = sig[k + 1];
    const c = sig[k + 2];
    if (b?.s === "op" && b.op === ":" && c?.s === "num" && c.d.isInteger()) {
      const h = a.d.toNumber();
      const m = c.d.toNumber();
      if (h <= 23 && m <= 59) {
        mins = h * 60 + m;
        len = 3;
        const d1 = sig[k + 3];
        const e1 = sig[k + 4];
        if (d1?.s === "op" && d1.op === ":" && e1?.s === "num") len = 5;
      }
    } else if (isAmpmTok(b)) {
      const h = a.d.toNumber();
      if (h >= 1 && h <= 12) {
        mins = (h % 12) * 60;
        len = 1;
      }
    }
    if (mins < 0) continue;
    const tail = sig[k + len];
    if (isAmpmTok(tail)) {
      const pm = ampmIsPm(tail!);
      const h = Math.floor(mins / 60);
      if (pm && h < 12) mins += 720;
      if (!pm && h === 12) mins -= 720;
      len++;
    }
    sig.splice(k, len, { s: "clock", mins, from: a.from, to: sig[k + len - 1].to });
  }
  // surviving ':' ops and stray am/pm are noise
  for (let k = sig.length - 1; k >= 0; k--) {
    const t = sig[k];
    if ((t.s === "op" && t.op === ":") || t.s === "ampm") sig.splice(k, 1);
  }

  return { sig, sem };
}

// ---------------------------------------------------------------------------
// parsing
// ---------------------------------------------------------------------------

export type ParseResult = { kind: "expr"; node: Node } | { kind: "agg"; name: string } | null;

const isKw = (t: Sig | undefined, kw: string): boolean => !!t && t.s === "kw" && t.kw === kw;
const isOp = (t: Sig | undefined, op: string): boolean => !!t && t.s === "op" && t.op === op;

function depths(sig: Sig[]): number[] {
  const out: number[] = [];
  let d = 0;
  for (const t of sig) {
    if (t.s === "rp") d = Math.max(0, d - 1);
    out.push(d);
    if (t.s === "lp") d++;
  }
  return out;
}

export function parseSig(sig: Sig[]): ParseResult {
  if (sig.length === 0) return null;
  assembleDates(sig);
  assembleTimes(sig);

  const first = sig[0];
  if (sig.length === 1 && first.s === "kw" && AGGS.has(first.kw)) return { kind: "agg", name: first.kw };

  // bare unit pair: "usd eur", "km m" means "1 usd in eur"
  if (sig.length === 2 && sig[0].s === "unit" && sig[1].s === "unit") {
    const a = sig[0].unit;
    const b = sig[1].unit;
    return {
      kind: "expr",
      node: { n: "convert", c: { n: "value", v: { kind: "quantity", d: new Decimal(1), unit: a } }, t: { k: "unit", unit: b } },
    };
  }

  // aggregate over an inline list: "total of 3, 4, 7 and 9"
  // ("total repayment on ..." is a finance phrase, not an aggregate)
  const aggBlocked = sig[1]?.s === "kw" && /^(re)?payments?$/.test(sig[1].kw);
  if (first.s === "kw" && AGGS.has(first.kw) && sig.length > 1 && !aggBlocked) {
    let i = 1;
    if (isKw(sig[i], "of")) i++;
    const dep = depths(sig);
    const parts: Sig[][] = [];
    let cur: Sig[] = [];
    for (let k = i; k < sig.length; k++) {
      const t = sig[k];
      if (dep[k] === 0 && (t.s === "comma" || isKw(t, "and"))) {
        parts.push(cur);
        cur = [];
      } else cur.push(t);
    }
    parts.push(cur);
    if (parts.length >= 1 && parts.every((p) => p.length > 0)) {
      const args = parts.map((p) => parseSlice(p));
      if (args.every((a): a is Node => a !== null)) {
        return { kind: "expr", node: { n: "fn", name: first.kw, args } };
      }
    }
  }

  const node = parseSlice(sig);
  return node ? { kind: "expr", node } : null;
}

function parseSlice(sigIn: Sig[]): Node | null {
  let sig = sigIn;
  if (sig.length === 0) return null;
  const dep = depths(sig);
  const at0 = (k: number) => dep[k] === 0;

  // -- change: "50 to 75 is what %" / "50 to 75 as %"
  {
    const n = sig.length;
    const last = sig[n - 1];
    if (last && isOp(last, "%") && at0(n - 1)) {
      let head = -1;
      if (isKw(sig[n - 3], "is") && isKw(sig[n - 2], "what")) head = n - 3;
      else if (isKw(sig[n - 2], "as")) head = n - 2;
      else if (isKw(sig[n - 3], "as") && isKw(sig[n - 2], "a")) head = n - 3;
      if (head > 0) {
        for (let t = 0; t < head; t++) {
          if (isKw(sig[t], "to") && at0(t) && t > 0) {
            const a = parseSlice(sig.slice(0, t));
            const b = parseSlice(sig.slice(t + 1, head));
            if (a && b) return { n: "change", a, b };
            break;
          }
        }
      }
    }
  }

  // -- "x is what % of y" / "x as a % of y" (of|off|on)
  for (let i = 1; i < sig.length; i++) {
    if (!at0(i)) continue;
    const t = sig[i];
    if (!(isKw(t, "is") || isKw(t, "as"))) continue;
    let j = i + 1;
    if (isKw(sig[j], "what") || isKw(sig[j], "a")) j++;
    if (!isOp(sig[j], "%")) continue;
    j++;
    const f = sig[j];
    const form = isKw(f, "of") ? "of" : isKw(f, "off") ? "off" : isKw(f, "on") ? "on" : null;
    if (!form) continue;
    const x = parseSlice(sig.slice(0, i));
    const y = parseSlice(sig.slice(j + 1));
    if (x && y) return { n: "aspct", form, x, y };
  }

  // -- "x is p% of what" (of|off|on)
  {
    const n = sig.length;
    if (isKw(sig[n - 1], "what") && at0(n - 1)) {
      const f = sig[n - 2];
      const form = isKw(f, "of") ? "of" : isKw(f, "off") ? "off" : isKw(f, "on") ? "on" : null;
      if (form) {
        for (let i = 1; i < n - 2; i++) {
          if (isKw(sig[i], "is") && at0(i)) {
            const x = parseSlice(sig.slice(0, i));
            const p = parseSlice(sig.slice(i + 1, n - 2));
            if (x && p) return { n: "what", form, x, p };
            break;
          }
        }
      }
    }
  }

  // -- time and date phrases
  sig = stripDateAnnotations(sig);

  // conversion first, so "A to B in workdays" hands its range to the target
  // (the left side re-enters this pipeline and still becomes a date span)
  {
    const dp = depths(sig);
    for (let i = sig.length - 1; i > 0; i--) {
      if (dp[i] !== 0) continue;
      const t = sig[i];
      if (!(t.s === "kw" && (t.kw === "in" || t.kw === "to" || t.kw === "as" || t.kw === "into"))) continue;
      const target = parseTarget(sig.slice(i + 1));
      if (!target) continue;
      const lhs = parseSlice(sig.slice(0, i));
      if (lhs) return { n: "convert", c: lhs, t: target };
    }
  }

  const taxNode = taxScans(sig);
  if (taxNode) return taxNode;
  const finNode = financeScans(sig);
  if (finNode) return finNode;

  const timeNode = timeScans(sig);
  if (timeNode) return timeNode;
  const dateNode = dateScans(sig);
  if (dateNode) return dateNode;

  // -- strip filler; "a"/"an" before a unit means "per"
  const STRIP = new Set(["is", "what", "and", "an", "a", "from", "after", "before", "since", "until", "till", "ago", "between", "left", "next", "last", "time", "timediff"]);
  const stripped: Sig[] = [];
  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];
    if (t.s === "zone") {
      // keep a zone only where it is a conversion target ("in Chicago"); stray places are prose
      const prev = sig[i - 1];
      if (prev?.s === "kw" && (prev.kw === "in" || prev.kw === "to" || prev.kw === "as" || prev.kw === "into")) {
        stripped.push(t);
      }
      continue;
    }
    if (t.s === "kw" && STRIP.has(t.kw)) {
      if ((t.kw === "a" || t.kw === "an") && sig[i + 1]?.s === "unit") {
        stripped.push({ s: "op", op: "/", spacedL: true, from: t.from, to: t.to });
      }
      continue;
    }
    stripped.push(t);
  }
  sig = stripped;
  if (sig.length === 0) return null;

  return runSplit(sig);
}

// "$300 + VAT" / "$300 - VAT" (divides out included tax) / "VAT on $300" (the tax portion)
function taxScans(sig: Sig[]): Node | null {
  const dep = depths(sig);
  const n = sig.length;
  if (n >= 3 && sig[n - 1].s === "tax" && dep[n - 1] === 0) {
    const o = sig[n - 2];
    if (o.s === "op" && (o.op === "+" || o.op === "-") && dep[n - 2] === 0) {
      const c = parseSlice(sig.slice(0, n - 2));
      if (c) return { n: "tax", mode: o.op === "+" ? "add" : "remove", c };
    }
  }
  if (n >= 3 && sig[0].s === "tax" && isKw(sig[1], "on")) {
    const c = parseSlice(sig.slice(2));
    if (c) return { n: "tax", mode: "portion", c };
  }
  return null;
}

// compounds/payments per year for finance phrases
const FREQ: Record<string, number> = { annual: 1, annually: 1, yearly: 1, quarterly: 4, monthly: 12, weekly: 52, daily: 365 };

// compound interest, loan repayments, and annualized return - see SPEC.md Finance
function financeScans(sig: Sig[]): Node | null {
  const dep = depths(sig);
  const kwAt = (k: number): string | null => {
    const t = sig[k];
    return t?.s === "kw" && dep[k] === 0 ? t.kw : null;
  };
  // a rate slice must contain a percent, so "at 5pm" never reads as an interest rate
  const hasPct = (toks: Sig[]) => toks.some((t) => (t.s === "op" && t.op === "%") || (t.s === "fmt" && t.fmt.startsWith("percent")));

  // [interest on] <principal> after <duration> at <rate> [compounding <freq>]
  {
    let end = sig.length;
    let freq = 1; // Soulver compounds annually unless told otherwise
    const fw = kwAt(end - 1);
    if (fw && FREQ[fw] && ["compounding", "compounded"].includes(kwAt(end - 2) ?? "")) {
      freq = FREQ[fw];
      end -= 2;
    }
    for (let j = end - 1; j > 1; j--) {
      if (kwAt(j) !== "at" || !hasPct(sig.slice(j + 1, end))) continue;
      for (let i = j - 1; i > 0; i--) {
        if (kwAt(i) !== "after") continue;
        const durToks = sig.slice(i + 1, j);
        if (!durToks.some((t) => t.s === "unit" && t.unit.category === "duration")) continue;
        const interestOnly = kwAt(0) === "interest" && kwAt(1) === "on";
        const p = parseSlice(sig.slice(interestOnly ? 2 : 0, i));
        const years = parseSlice(durToks);
        const rate = parseSlice(sig.slice(j + 1, end));
        if (p && years && rate) return { n: "fin", op: interestOnly ? "interest" : "ci", p, years, rate, freq };
      }
    }
  }

  // [monthly|yearly|daily|weekly|quarterly|total] repayment on <principal> over <duration> at <rate>
  {
    const isRepay = (w: string | null) => !!w && /^(re)?payments?$/.test(w);
    let rp = -1;
    let freq = 12; // repayments are monthly unless told otherwise
    let total = false;
    const first = kwAt(0);
    if (isRepay(first)) rp = 0;
    else if (first && isRepay(kwAt(1))) {
      if (FREQ[first]) {
        freq = FREQ[first];
        rp = 1;
      } else if (first === "total") {
        total = true;
        rp = 1;
      }
    }
    if (rp >= 0 && kwAt(rp + 1) === "on") {
      for (let i = rp + 3; i < sig.length; i++) {
        if (kwAt(i) !== "over") continue;
        for (let j = i + 2; j < sig.length; j++) {
          if (kwAt(j) !== "at" || !hasPct(sig.slice(j + 1))) continue;
          const p = parseSlice(sig.slice(rp + 2, i));
          const years = parseSlice(sig.slice(i + 1, j));
          const rate = parseSlice(sig.slice(j + 1));
          if (p && years && rate) return { n: "fin", op: "loan", p, years, rate, freq, total };
        }
      }
    }
  }

  // [annual] return on <invested> invested <returned> returned after <duration>
  {
    const k = kwAt(0) === "annual" || kwAt(0) === "annualized" ? 1 : 0;
    if (kwAt(k) === "return" && kwAt(k + 1) === "on") {
      const find = (w: string, from: number) => {
        for (let i = from; i < sig.length; i++) if (kwAt(i) === w) return i;
        return -1;
      };
      const inv = find("invested", k + 2);
      const ret = inv < 0 ? -1 : find("returned", inv + 2);
      const aft = ret < 0 ? -1 : find("after", ret + 1);
      if (inv > k + 2 && ret > inv + 1 && aft >= ret) {
        const p = parseSlice(sig.slice(k + 2, inv));
        const r = parseSlice(sig.slice(inv + 1, ret));
        const years = parseSlice(sig.slice(aft + 1));
        if (p && r && years) return { n: "fin", op: "cagr", p, years, ret: r };
      }
    }
  }

  return null;
}

function parseTarget(toks: Sig[]): Target | null {
  if (toks.length === 0) return null;
  const a = toks[0];
  if (toks.length === 1) {
    if (a.s === "fmt") {
      const map: Record<string, string> = { hexadecimal: "hex", binary: "bin", octal: "oct", decimal: "dec", number: "num", percentage: "percent", scientific: "sci" };
      return { k: "fmt", fmt: map[a.fmt] ?? a.fmt };
    }
    if (a.s === "op" && a.op === "%") return { k: "fmt", fmt: "percent" };
    if (a.s === "unit") return { k: "unit", unit: a.unit };
    if (a.s === "zone") return { k: "zone", zone: a.zone };
    return null;
  }
  if (toks.length === 2) {
    if (isKw(a, "nearest") && toks[1].s === "num") return { k: "nearest", m: toks[1].d };
    if (a.s === "num" && (isKw(toks[1], "dp") || isKw(toks[1], "digits"))) return { k: "dp", n: a.d.toNumber() };
  }
  if (toks.length === 3 && a.s === "unit" && isOp(toks[1], "/") && toks[2].s === "unit") {
    return { k: "rate", num: a.unit, den: toks[2].unit };
  }
  // "feet and inches" / "lb and oz": big unit with a smaller same-category remainder
  if (toks.length === 3 && a.s === "unit" && isKw(toks[1], "and") && toks[2].s === "unit") {
    const b = toks[2] as Extract<Sig, { s: "unit" }>;
    if (b.unit.category === a.unit.category && b.unit.factor.lt(a.unit.factor)) {
      return { k: "unit", unit: a.unit, sub: b.unit };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pratt parser with "last valid expression" recovery
// ---------------------------------------------------------------------------

interface PE {
  node: Node;
  pos: number;
}

const valueStart = (t: Sig | undefined): boolean =>
  !!t && (t.s === "num" || t.s === "unit" || t.s === "lp" || t.s === "fn" || t.s === "const" || t.s === "var" || t.s === "ref");

function runSplit(sig: Sig[]): Node | null {
  let best: PE | null = null;
  for (let start = 0; start < sig.length; start++) {
    const r = parseExpr(sig, start, 0);
    if (!r) continue;
    const bare = r.node.n === "value" && r.node.bare === true;
    if (r.pos === sig.length && !bare) return r.node;
    if (bare) continue;
    if (!best || r.pos > best.pos) best = r;
  }
  return best ? best.node : null;
}

function parseExpr(sig: Sig[], pos: number, minBp: number): PE | null {
  let left = parsePrimary(sig, pos);
  if (!left) return null;
  let p = left.pos;
  let node = left.node;

  for (;;) {
    const t = sig[p];
    if (!t) break;

    let op: string | null = null;
    let bp = 0;
    let consume = 1;

    if (t.s === "op" && (t.op === "+" || t.op === "-")) {
      op = t.op;
      bp = 2;
    } else if (t.s === "kw" && (t.kw === "off" || t.kw === "on")) {
      op = t.kw;
      bp = 2;
    } else if (t.s === "kw" && t.kw === "of") {
      op = "of";
      bp = 3;
    } else if (t.s === "op" && (t.op === "*" || t.op === "/")) {
      op = t.op;
      bp = 4;
    } else if (t.s === "op" && t.op === "%") {
      op = "mod"; // percent-postfix was already taken in parsePrimary; a surviving % is modulo
      bp = 4;
    } else if (t.s === "kw" && t.kw === "mod") {
      op = "mod";
      bp = 4;
    } else if (t.s === "kw" && t.kw === "at") {
      op = "at"; // binds looser than "/" so "30 hours at $30/hour" sees the whole rate
      bp = 3;
    } else if (t.s === "op" && t.op === "^") {
      op = "^";
      bp = 6;
    } else if (t.s === "lp" || t.s === "fn" || t.s === "const") {
      op = "*"; // implicit multiplication: 2(3+4), 2sin(x), 2 pi
      bp = 4;
      consume = 0;
    } else break;

    if (bp < minBp) break;
    const rhsPos = p + consume;
    const rhs = parseExpr(sig, rhsPos, op === "^" ? bp : bp + 1);
    if (!rhs) break; // dangling operator: keep what we have
    node = { n: "bin", op, l: node, r: rhs.node };
    p = rhs.pos;
  }
  return { node, pos: p };
}

function affMult(w: string, currency: boolean): Decimal | null {
  if (currency) {
    if (/^k$/i.test(w)) return new Decimal(1e3);
    if (/^(m|mn)$/i.test(w)) return new Decimal(1e6);
    if (/^(b|bn)$/i.test(w)) return new Decimal(1e9);
    if (/^(t|tn)$/i.test(w)) return new Decimal(1e12);
    return null;
  }
  if (w === "k" || w === "K") return new Decimal(1e3);
  if (w === "M") return new Decimal(1e6);
  if (w === "G") return new Decimal(1e9);
  if (w === "T") return new Decimal(1e12);
  return null;
}

const pctHere = (sig: Sig[], p: number): boolean => {
  const t = sig[p];
  if (!t || t.s !== "op" || t.op !== "%") return false;
  return !t.spacedL || !valueStart(sig[p + 1]);
};

// parse a number with its postfix cloud: suffix letters, word multipliers, %, units, compound units
function parseNumberish(sig: Sig[], pos: number, currencyUnit: Unit | null): PE | null {
  const t = sig[pos];
  if (!t || t.s !== "num") return null;
  let d = t.d;
  let p = pos + 1;
  let unit: Unit | null = null;

  // glued suffix: 3k / $5m / 10m / 250g
  const aff = sig[p];
  if (aff && aff.s === "aff") {
    const m = affMult(aff.w, currencyUnit !== null || sig[p + 1]?.s === "unit");
    if (m) {
      d = d.mul(m);
      p++;
    } else {
      const u = lookupUnitWord(aff.w);
      if (u && !currencyUnit) {
        unit = u;
        p++;
      } else {
        p++; // unusable suffix (ordinals like 16th): ignore it
      }
    }
  }
  // word multiplier: 1.4 million
  const mt = sig[p];
  if (mt && mt.s === "mult") {
    d = d.mul(mt.d);
    p++;
  }

  if (currencyUnit) return { node: { n: "value", v: { kind: "quantity", d, unit: currencyUnit } }, pos: p };

  // percent literal
  if (!unit && pctHere(sig, p)) {
    return { node: { n: "value", v: { kind: "percent", d } }, pos: p + 1 };
  }

  // unit after the number (with compound folding: 5 hours 30 minutes)
  if (!unit && sig[p]?.s === "unit") {
    unit = (sig[p] as Extract<Sig, { s: "unit" }>).unit;
    p++;
  }
  if (unit) {
    if (unit.category === "currency") return { node: { n: "value", v: { kind: "quantity", d, unit } }, pos: p };
    let base = d.mul(unit.factor);
    let bigUnit = unit;
    // durations remember months vs days separately, so date math can be calendar-aware
    const isDur = unit.category === "duration";
    let calMonths = 0;
    let calDays = 0;
    const addCal = (n: Decimal, u: Unit) => {
      if (u.id === "month") calMonths += n.toNumber();
      else if (u.id === "year") calMonths += n.toNumber() * 12;
      else calDays += n.mul(u.factor).div(86400).toNumber();
    };
    if (isDur) addCal(d, unit);
    for (;;) {
      const n2 = sig[p];
      if (n2?.s !== "num") break;
      const u2 = sig[p + 1];
      let next: Unit | null = null;
      if (u2?.s === "unit") next = u2.unit;
      // glued suffix units fold too (5' 6", 5h 30min) - but never multiplier lookalikes like 3k
      else if (u2?.s === "aff" && !/^(k|m|b|t|bn|tn|mn)$/i.test(u2.w)) next = lookupUnitWord(u2.w);
      if (next && next.category === unit.category) {
        base = base.plus(n2.d.mul(next.factor));
        if (isDur) addCal(n2.d, next);
        if (next.factor.gt(bigUnit.factor)) bigUnit = next;
        p += 2;
      } else break;
    }
    const v: Value = { kind: "quantity", d: base.div(bigUnit.factor), unit: bigUnit };
    if (isDur) v.cal = { months: calMonths, days: calDays };
    // "300g butter" / "2 cups flour": the substance carries its density for mass<->volume
    const sub = sig[p];
    if (sub?.s === "subst" && (bigUnit.category === "mass" || bigUnit.category === "volume")) {
      v.dens = sub.dens;
      p++;
    }
    return { node: { n: "value", v }, pos: p };
  }

  // "5 watermelons": a number glued to a variable multiplies it (custom units)
  const nv = sig[p];
  if (nv?.s === "var") {
    return { node: { n: "bin", op: "*", l: { n: "value", v: { kind: "number", d } }, r: { n: "var", name: nv.name } }, pos: p + 1 };
  }

  return { node: { n: "value", v: { kind: "number", d } }, pos: p };
}

function parsePrimary(sig: Sig[], pos: number): PE | null {
  const t = sig[pos];
  if (!t) return null;

  if (t.s === "num") return parseNumberish(sig, pos, null);

  if (t.s === "unit") {
    if (t.unit.category === "currency" && sig[pos + 1]?.s === "num") {
      return parseNumberish(sig, pos + 1, t.unit);
    }
    // bare unit = 1 of it (needed for "30 / week"); flagged so a lone stray unit word
    // in prose does not produce a phantom answer
    return { node: { n: "value", v: { kind: "quantity", d: new Decimal(1), unit: t.unit }, bare: true }, pos: pos + 1 };
  }

  if (t.s === "lap") {
    return { node: { n: "value", v: { kind: "quantity", d: t.secs, unit: unitById("s"), disp: { mode: "laptime" } } }, pos: pos + 1 };
  }

  if (t.s === "dateval") {
    return { node: { n: "value", v: { kind: "date", d: new Decimal(t.ed) } }, pos: pos + 1 };
  }

  if (t.s === "clock") {
    // a bare clock time means today, local
    const nowMin = Date.now() / 60000;
    const w = epochMinToWall(localZone(), nowMin);
    const em = wallToEpochMin(localZone(), w.y, w.m, w.d, t.mins);
    return { node: { n: "value", v: { kind: "time", d: new Decimal(em), anchored: false } }, pos: pos + 1 };
  }
  if (t.s === "timeval") {
    return { node: { n: "value", v: { kind: "time", d: new Decimal(t.epochMin), zone: t.zone, anchored: true } }, pos: pos + 1 };
  }

  if (t.s === "op" && t.op === "-") {
    const c = parseExpr(sig, pos + 1, 5);
    if (!c) return null;
    return { node: { n: "neg", c: c.node }, pos: c.pos };
  }
  if (t.s === "op" && t.op === "+") return parseExpr(sig, pos + 1, 5);

  if (t.s === "lp") {
    const inner = parseExpr(sig, pos + 1, 0);
    if (!inner) return null;
    if (sig[inner.pos]?.s !== "rp") return null;
    return { node: inner.node, pos: inner.pos + 1 };
  }

  if (t.s === "fn") {
    let p = pos + 1;
    if (sig[p]?.s === "lp") {
      p++;
      const args: Node[] = [];
      if (sig[p]?.s === "rp") return null;
      for (;;) {
        const a = parseExpr(sig, p, 0);
        if (!a) return null;
        args.push(a.node);
        p = a.pos;
        if (sig[p]?.s === "comma" || isKw(sig[p], "and")) {
          p++;
          continue;
        }
        break;
      }
      if (sig[p]?.s !== "rp") return null;
      return { node: { n: "fn", name: t.name, args }, pos: p + 1 };
    }
    if (isKw(sig[p], "of")) p++;
    const a = parseExpr(sig, p, 5);
    if (!a) return null;
    return { node: { n: "fn", name: t.name, args: [a.node] }, pos: a.pos };
  }

  if (t.s === "const") {
    let node: Node = { n: "value", v: { kind: "number", d: t.d } };
    let p = pos + 1;
    if (pctHere(sig, p)) {
      node = { n: "value", v: { kind: "percent", d: t.d } };
      p++;
    }
    return { node, pos: p };
  }

  if (t.s === "var") {
    let p = pos + 1;
    if (pctHere(sig, p)) p++; // "discount%" where discount is already a percent
    return { node: { n: "var", name: t.name }, pos: p };
  }
  if (t.s === "ref") return { node: { n: "ref", idx: t.idx }, pos: pos + 1 };

  return null;
}

// ---------------------------------------------------------------------------
// date support
// ---------------------------------------------------------------------------

// fold [month, day, year?] / [day, month, year?] / ISO / next+weekday runs into dateval tokens
function assembleDates(sig: Sig[]): void {
  const yearOf = (t: Sig | undefined): number | null =>
    t?.s === "num" && t.d.isInteger() && t.d.gte(1000) && t.d.lte(3000) ? t.d.toNumber() : null;
  const dayOf = (t: Sig | undefined): number | null =>
    t?.s === "num" && t.d.isInteger() && t.d.gte(1) && t.d.lte(31) ? t.d.toNumber() : null;
  const curYear = fromEpochDay(todayEpoch()).y;

  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];

    if (t.s === "kw" && (t.kw === "next" || t.kw === "last") && sig[i + 1]?.s === "wday") {
      const wd = sig[i + 1] as Extract<Sig, { s: "wday" }>;
      const ed = nearestWeekday(todayEpoch(), wd.w, t.kw === "next" ? 1 : -1);
      sig.splice(i, 2, { s: "dateval", ed, from: t.from, to: wd.to });
      continue;
    }

    // ISO 2020-01-19 (hyphens must be tight, or it is arithmetic)
    if (t.s === "num") {
      const y = yearOf(t);
      const o1 = sig[i + 1];
      const mth = sig[i + 2];
      const o2 = sig[i + 3];
      const day = sig[i + 4];
      if (
        y !== null &&
        o1?.s === "op" && o1.op === "-" && !o1.spacedL &&
        mth?.s === "num" && o2?.s === "op" && o2.op === "-" && !o2.spacedL &&
        day?.s === "num"
      ) {
        const mm = mth.d.toNumber();
        const dd = day.d.toNumber();
        if (Number.isInteger(mm) && mm >= 1 && mm <= 12 && Number.isInteger(dd) && dd >= 1 && dd <= 31) {
          sig.splice(i, 5, { s: "dateval", ed: toEpochDay({ y, m: mm, d: dd }), from: t.from, to: day.to });
          continue;
        }
      }
    }

    // June 10 / June 10, 2019
    if (t.s === "month") {
      const d = dayOf(sig[i + 1]);
      if (d !== null) {
        let len = 2;
        let to = sig[i + 1].to;
        let y = curYear;
        let j = i + 2;
        if (sig[j]?.s === "comma") j++;
        const yy = yearOf(sig[j]);
        if (yy !== null) {
          y = yy;
          len = j - i + 1;
          to = sig[j].to;
        }
        sig.splice(i, len, { s: "dateval", ed: toEpochDay({ y, m: t.m, d }), from: t.from, to });
        continue;
      }
    }

    // 10 June / 3 March 2020
    if (t.s === "num") {
      const d = dayOf(t);
      const mo = sig[i + 1];
      if (d !== null && mo?.s === "month") {
        let len = 2;
        let to = mo.to;
        let y = curYear;
        let j = i + 2;
        if (sig[j]?.s === "comma") j++;
        const yy = yearOf(sig[j]);
        if (yy !== null) {
          y = yy;
          len = j - i + 1;
          to = sig[j].to;
        }
        sig.splice(i, len, { s: "dateval", ed: toEpochDay({ y, m: mo.m, d }), from: t.from, to });
        continue;
      }
    }
  }
}

const todayNode = (): Node => ({ n: "value", v: { kind: "date", d: new Decimal(todayEpoch()) } });
const isDurUnit = (t: Sig | undefined): t is Extract<Sig, { s: "unit" }> => t?.s === "unit" && t.unit.category === "duration";
const hasDate = (toks: Sig[]): boolean => toks.some((t) => t.s === "dateval");
const yearLike = (t: Sig | undefined): number | null =>
  t?.s === "num" && t.d.isInteger() && t.d.gte(1500) && t.d.lte(2999) ? t.d.toNumber() : null;

// "lunch $20 on March 5" / "lunch $20 at 1pm" are annotated expenses, not time math
function stripDateAnnotations(sig: Sig[]): Sig[] {
  const n = sig.length;
  if (n >= 3) {
    const kw = sig[n - 2];
    const dv = sig[n - 1];
    const dateish = dv.s === "dateval" || dv.s === "clock" || dv.s === "timeval";
    if (dateish && kw.s === "kw" && (kw.kw === "on" || kw.kw === "from" || kw.kw === "at")) {
      const before = sig[n - 3];
      if (!isDurUnit(before) && before.s !== "wdfn" && before.s !== "clock" && before.s !== "timeval" && before.s !== "dateval") {
        return sig.slice(0, n - 2);
      }
    }
  }
  return sig;
}

function dateScans(sig: Sig[]): Node | null {
  const dep = depths(sig);
  const at0 = (k: number) => dep[k] === 0;
  const findKw = (...kws: string[]): number => {
    for (let k = 0; k < sig.length; k++) {
      const t = sig[k];
      if (at0(k) && t.s === "kw" && kws.includes(t.kw)) return k;
    }
    return -1;
  };

  // weekday on <date>
  if (sig[0]?.s === "wdfn") {
    let j = 1;
    if (isKw(sig[j], "on")) j++;
    const c = parseSlice(sig.slice(j));
    if (c) return { n: "wdname", c };
  }

  // days between <a> and <b>
  if (isDurUnit(sig[0]) && isKw(sig[1], "between")) {
    for (let k = 2; k < sig.length; k++) {
      if (at0(k) && isKw(sig[k], "and")) {
        const a = parseSlice(sig.slice(2, k));
        const b = parseSlice(sig.slice(k + 1));
        if (a && b) return { n: "span", a, b, unit: sig[0].unit };
        break;
      }
    }
  }

  // workdays from <a> to <b>
  if (isDurUnit(sig[0]) && isKw(sig[1], "from")) {
    for (let k = 3; k < sig.length; k++) {
      if (at0(k) && isKw(sig[k], "to")) {
        const a = parseSlice(sig.slice(2, k));
        const b = parseSlice(sig.slice(k + 1));
        if (a && b) return { n: "span", a, b, unit: sig[0].unit };
        break;
      }
    }
  }

  // [days] since/until <date>; a bare weekday after means its next/previous occurrence
  {
    const k = findKw("since", "until", "till");
    if (k !== -1) {
      const left = sig.slice(0, k);
      const unit = left.length === 0 ? undefined : left.length === 1 && isDurUnit(left[0]) ? left[0].unit : null;
      if (unit !== null) {
        const kw = (sig[k] as Extract<Sig, { s: "kw" }>).kw;
        const right = sig.slice(k + 1);
        let r: Node | null = null;
        if (right.length === 1 && right[0].s === "wday") {
          const ed = nearestWeekday(todayEpoch(), right[0].w, kw === "since" ? -1 : 1);
          r = { n: "value", v: { kind: "date", d: new Decimal(ed) } };
        } else r = parseSlice(right);
        if (r) {
          return { n: "span", a: kw === "since" ? r : todayNode(), b: kw === "since" ? todayNode() : r, unit };
        }
      }
    }
  }

  // days in June / days left in 2027 / days in 3 weeks
  if (isDurUnit(sig[0]) && (isKw(sig[1], "in") || (isKw(sig[1], "left") && isKw(sig[2], "in")))) {
    const unit = sig[0].unit;
    const leftMode = isKw(sig[1], "left");
    const rest = sig.slice(leftMode ? 3 : 2);
    const curYear = fromEpochDay(todayEpoch()).y;
    const spanNode = (aEd: number, bEd: number): Node => ({
      n: "span",
      a: { n: "value", v: { kind: "date", d: new Decimal(aEd) } },
      b: { n: "value", v: { kind: "date", d: new Decimal(bEd) } },
      unit,
    });
    if (rest[0]?.s === "month") {
      const y = yearLike(rest[1]) ?? curYear;
      if (rest.length === 1 || (rest.length === 2 && yearLike(rest[1]) !== null)) {
        const start = toEpochDay({ y, m: rest[0].m, d: 1 });
        const end = start + daysInMonth(y, rest[0].m);
        return spanNode(leftMode ? todayEpoch() : start, end);
      }
    }
    const y = rest.length === 1 ? yearLike(rest[0]) : null;
    if (y !== null) {
      const start = toEpochDay({ y, m: 1, d: 1 });
      const end = toEpochDay({ y: y + 1, m: 1, d: 1 });
      return spanNode(leftMode ? todayEpoch() : start, end);
    }
    if (!leftMode && rest.length > 0) {
      const c = parseSlice(rest);
      if (c) return { n: "convert", c, t: { k: "unit", unit } };
    }
  }

  // <duration> after/before <date>
  {
    const k = findKw("after", "before");
    if (k > 0 && k < sig.length - 1) {
      const l = parseSlice(sig.slice(0, k));
      const r = parseSlice(sig.slice(k + 1));
      if (l && r) return { n: "bin", op: (sig[k] as Extract<Sig, { s: "kw" }>).kw, l, r };
    }
  }

  // <duration> from <date>
  {
    const k = findKw("from");
    if (k > 0 && k < sig.length - 1 && isDurUnit(sig[k - 1])) {
      const l = parseSlice(sig.slice(0, k));
      const r = parseSlice(sig.slice(k + 1));
      if (l && r) return { n: "bin", op: "after", l, r };
    }
  }

  // <duration> ago
  if (sig.length >= 2 && isKw(sig[sig.length - 1], "ago")) {
    const l = parseSlice(sig.slice(0, -1));
    if (l) return { n: "bin", op: "before", l, r: todayNode() };
  }

  // <date/time> to <date/time>, and year ranges like 1978 to 2021
  {
    const k = findKw("to");
    if (k > 0 && k < sig.length - 1) {
      const left = sig.slice(0, k);
      const right = sig.slice(k + 1);
      const years = left.length === 1 && right.length === 1 && yearLike(left[0]) !== null && yearLike(right[0]) !== null;
      const zoneTarget = right.length === 1 && right[0].s === "zone"; // "3pm GMT to Paris" is a conversion, not a range
      if (!zoneTarget && (hasDate(left) || hasDate(right) || hasTime(left) || hasTime(right) || years)) {
        const a = parseSlice(left);
        const b = parseSlice(right);
        if (a && b) return { n: "span", a, b };
      }
    }
  }

  return null;
}

const hasTime = (toks: Sig[]): boolean => toks.some((t) => t.s === "clock" || t.s === "timeval");

// zone attachment: GMT+8, "6pm Sydney", "March 5 2027 6pm Sydney", "3pm on March 5"
function assembleTimes(sig: Sig[]): void {
  // fixed offsets: GMT+8, UTC-5:30 (operator must be glued)
  for (let i = 0; i < sig.length; i++) {
    const z = sig[i];
    if (z.s !== "zone" || z.zone !== "Etc/UTC") continue;
    const op = sig[i + 1];
    const v = sig[i + 2];
    if (op?.s === "op" && (op.op === "+" || op.op === "-") && !op.spacedL && v) {
      let mins: number | null = null;
      if (v.s === "num" && v.d.isInteger() && v.d.abs().lte(14)) mins = v.d.toNumber() * 60;
      else if (v.s === "clock") mins = v.mins;
      if (mins !== null) {
        sig.splice(i, 3, { s: "zone", zone: `offset:${op.op === "-" ? -mins : mins}`, from: z.from, to: v.to });
      }
    }
  }

  for (let i = 0; i < sig.length; i++) {
    const t = sig[i];

    // <date> <clock> [<zone>]
    if (t.s === "dateval" && sig[i + 1]?.s === "clock") {
      const c = sig[i + 1] as Extract<Sig, { s: "clock" }>;
      const zn = sig[i + 2]?.s === "zone" ? (sig[i + 2] as Extract<Sig, { s: "zone" }>) : null;
      const zone = zn ? zn.zone : localZone();
      const { y, m, d } = fromEpochDay(t.ed);
      const em = wallToEpochMin(zone, y, m, d, c.mins);
      sig.splice(i, zn ? 3 : 2, { s: "timeval", epochMin: em, zone: zn ? zone : undefined, from: t.from, to: (zn ?? c).to });
      continue;
    }

    if (t.s === "clock") {
      // <clock> on <date>
      if (isKw(sig[i + 1], "on") && sig[i + 2]?.s === "dateval") {
        const dv = sig[i + 2] as Extract<Sig, { s: "dateval" }>;
        const { y, m, d } = fromEpochDay(dv.ed);
        const em = wallToEpochMin(localZone(), y, m, d, t.mins);
        sig.splice(i, 3, { s: "timeval", epochMin: em, from: t.from, to: dv.to });
        continue;
      }
      // <clock> <zone>: today by that zone's calendar
      if (sig[i + 1]?.s === "zone") {
        const zn = sig[i + 1] as Extract<Sig, { s: "zone" }>;
        const w = epochMinToWall(zn.zone, Date.now() / 60000);
        const em = wallToEpochMin(zn.zone, w.y, w.m, w.d, t.mins);
        sig.splice(i, 2, { s: "timeval", epochMin: em, zone: zn.zone, from: t.from, to: zn.to });
        continue;
      }
    }
  }
}

const hmQty = (mins: number): Node => ({
  n: "value",
  v: { kind: "quantity", d: new Decimal(Math.abs(mins)), unit: unitById("min"), disp: { mode: "hm" } },
});

function timeScans(sig: Sig[]): Node | null {
  const nowVal = (): Node => ({ n: "value", v: { kind: "time", d: new Decimal(Math.round(Date.now() / 60000)), anchored: true } });

  // time in <zone> / <zone> time
  if (isKw(sig[0], "time")) {
    const j = isKw(sig[1], "in") ? 2 : 1;
    if (sig.length === j + 1 && sig[j]?.s === "zone") {
      return { n: "convert", c: nowVal(), t: { k: "zone", zone: (sig[j] as Extract<Sig, { s: "zone" }>).zone } };
    }
  }
  if (sig.length === 2 && sig[0]?.s === "zone" && isKw(sig[1], "time")) {
    return { n: "convert", c: nowVal(), t: { k: "zone", zone: sig[0].zone } };
  }

  // time difference between <zone> and <zone>
  if (isKw(sig[0], "timediff")) {
    const zones = sig.filter((t): t is Extract<Sig, { s: "zone" }> => t.s === "zone");
    if (zones.length === 2) {
      const now = Date.now();
      return hmQty(offsetMin(zones[0].zone, now) - offsetMin(zones[1].zone, now));
    }
  }

  return null;
}

export { CalcError };
export type { Sig };
