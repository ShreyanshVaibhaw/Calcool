import { Decimal } from "./value";

export type RawTok =
  | { t: "num"; d: Decimal; from: number; to: number; att: boolean; base?: number }
  | { t: "word"; w: string; from: number; to: number; att: boolean }
  | { t: "op"; op: string; from: number; to: number; spacedL: boolean }
  | { t: "cur"; sym: string; from: number; to: number; att: boolean }
  | { t: "lp" | "rp" | "comma"; from: number; to: number };

const CUR_CHARS = "$€£¥₹₽₩฿₺";
const isDigit = (c: string) => c >= "0" && c <= "9";
const isWordStart = (c: string) => /[A-Za-z_°µπ²³]/.test(c);
const isWordChar = (c: string) => /[A-Za-z0-9_°µπ²³]/.test(c);

export function tokenize(line: string): RawTok[] {
  const toks: RawTok[] = [];
  let i = 0;
  let lastEnd = -1; // end offset of previous token, to detect attachment (no space between)

  const push = (t: RawTok) => {
    toks.push(t);
    lastEnd = t.to;
  };

  while (i < line.length) {
    const c = line[i];

    if (c === " " || c === "\t") {
      i++;
      continue;
    }

    if (CUR_CHARS.includes(c)) {
      push({ t: "cur", sym: c, from: i, to: i + 1, att: lastEnd === i });
      i++;
      continue;
    }

    // number literal
    if (isDigit(c) || (c === "." && isDigit(line[i + 1] ?? ""))) {
      const from = i;
      let base: number | undefined;
      let raw = "";

      if (c === "0" && "xXbBoO".includes(line[i + 1] ?? "") && /[0-9a-fA-F]/.test(line[i + 2] ?? "")) {
        const kind = line[i + 1].toLowerCase();
        base = kind === "x" ? 16 : kind === "b" ? 2 : 8;
        const bodyRe = base === 16 ? /[0-9a-fA-F_]/ : base === 2 ? /[01_]/ : /[0-7_]/;
        i += 2;
        let body = "";
        while (i < line.length && bodyRe.test(line[i])) {
          if (line[i] !== "_") body += line[i];
          i++;
        }
        push({ t: "num", d: new Decimal(parseInt(body, base)), from, to: i, att: lastEnd === from, base });
        continue;
      }

      let seenDot = false;
      while (i < line.length) {
        const ch = line[i];
        if (isDigit(ch)) {
          raw += ch;
          i++;
        } else if ((ch === "," || ch === "_") && isDigit(line[i + 1] ?? "")) {
          i++; // grouping separator
        } else if (ch === "." && !seenDot && isDigit(line[i + 1] ?? "")) {
          seenDot = true;
          raw += ".";
          i++;
        } else if ((ch === "e" || ch === "E") && (isDigit(line[i + 1] ?? "") || ("+-".includes(line[i + 1] ?? "") && isDigit(line[i + 2] ?? "")))) {
          raw += "e";
          i++;
          if ("+-".includes(line[i])) {
            raw += line[i];
            i++;
          }
          while (i < line.length && isDigit(line[i])) {
            raw += line[i];
            i++;
          }
          break;
        } else break;
      }
      push({ t: "num", d: new Decimal(raw), from, to: i, att: lastEnd === from });
      continue;
    }

    if (isWordStart(c)) {
      const from = i;
      let w = "";
      while (i < line.length && isWordChar(line[i])) {
        w += line[i];
        i++;
      }
      push({ t: "word", w, from, to: i, att: lastEnd === from });
      continue;
    }

    const spacedL = lastEnd !== i;
    const two = line.slice(i, i + 2);
    if (two === "**") {
      push({ t: "op", op: "^", from: i, to: i + 2, spacedL });
      i += 2;
      continue;
    }
    if (two === "==" || two === "!=" || two === ">=" || two === "<=") {
      // comparisons are post-v1; tokenized so the classifier can drop them cleanly
      push({ t: "op", op: two, from: i, to: i + 2, spacedL });
      i += 2;
      continue;
    }

    if ("+-*/^%=:<>".includes(c) || c === "×" || c === "÷" || c === "−") {
      const op = c === "×" ? "*" : c === "÷" ? "/" : c === "−" ? "-" : c;
      push({ t: "op", op, from: i, to: i + 1, spacedL });
      i++;
      continue;
    }
    if (c === "(") {
      push({ t: "lp", from: i, to: i + 1 });
      i++;
      continue;
    }
    if (c === ")") {
      push({ t: "rp", from: i, to: i + 1 });
      i++;
      continue;
    }
    if (c === ",") {
      push({ t: "comma", from: i, to: i + 1 });
      i++;
      continue;
    }

    i++; // anything else: skip the character
  }
  return toks;
}
