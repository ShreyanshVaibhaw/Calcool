import { normalizeVarName } from "./engine/parse";
import { maskComments } from "./engine/sheet";
import { tokenize } from "./engine/tokenize";

// Variable names defined by "name = ..." lines, in definition order, deduped.
// Mirrors the sheet's assignment detection (words-only left side, depth-0 "=",
// leading-1 custom units), so completion and rename agree with evaluation.
// Pass beforeLine (1-based) to collect only definitions above a cursor line.
export function collectVariables(text: string, beforeLine?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const lines = text.split("\n");
  const end = beforeLine === undefined ? lines.length : Math.min(beforeLine - 1, lines.length);
  for (let n = 0; n < end; n++) {
    const { masked } = maskComments(lines[n]);
    const toks = tokenize(masked);
    let depth = 0;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.t === "lp") depth++;
      else if (t.t === "rp") depth--;
      else if (t.t === "op" && t.op === "=" && depth === 0) {
        const first = toks[0];
        const lead = first?.t === "num" && first.d.eq(1) ? 1 : 0;
        if (i > lead && toks.slice(lead, i).every((w) => w.t === "word")) {
          const name = normalizeVarName(masked.slice(toks[lead].from, toks[i - 1].to));
          if (name && !seen.has(name)) {
            seen.add(name);
            out.push(name);
          }
        }
        break;
      }
    }
  }
  return out;
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Longest known variable name covering (lineNo, col), or null in prose.
// lineNo is 1-based, col is 0-based within the line.
export function variableAt(text: string, lineNo: number, col: number): string | null {
  const lines = text.split("\n");
  const line = lines[lineNo - 1];
  if (line === undefined) return null;
  const names = collectVariables(text).sort((a, b) => b.length - a.length);
  for (const name of names) {
    const re = new RegExp(`(?<![A-Za-z0-9_])${name.split(" ").map(escapeRegExp).join("\\s+")}(?![A-Za-z0-9_])`, "gi");
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) {
      if (col >= m.index && col <= m.index + m[0].length) return name;
    }
  }
  return null;
}

// Whole-word ranges of one variable across the doc, for use highlighting.
export function variableUses(text: string, name: string): { from: number; to: number }[] {
  const re = new RegExp(`(?<![A-Za-z0-9_])${name.split(" ").map(escapeRegExp).join("\\s+")}(?![A-Za-z0-9_])`, "gi");
  const out: { from: number; to: number }[] = [];
  let off = 0;
  for (const raw of text.split("\n")) {
    const { spans } = maskComments(raw);
    const isComment = (i: number): boolean => spans.some((s) => i >= s.from && i < s.to);
    let m: RegExpExecArray | null;
    re.lastIndex = 0;
    while ((m = re.exec(raw))) {
      if (!isComment(m.index)) out.push({ from: off + m.index, to: off + m.index + m[0].length });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
    off += raw.length + 1;
  }
  return out;
}
