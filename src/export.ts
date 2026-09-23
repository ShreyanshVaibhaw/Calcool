import { evaluateSheet } from "./engine/sheet";

export interface OutputRow {
  line: string;
  answer: string;
}

// Every sheet line paired with its live answer ("" when the line has none).
export function sheetRows(text: string): OutputRow[] {
  const sheet = evaluateSheet(text);
  return text.split("\n").map((line, i) => ({ line, answer: sheet.lines[i]?.formatted ?? "" }));
}

const csvCell = (s: string): string => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCSV(rows: OutputRow[]): string {
  return ["line,answer", ...rows.map((r) => `${csvCell(r.line)},${csvCell(r.answer)}`)].join("\n") + "\n";
}

const htmlEsc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toHTML(title: string, rows: OutputRow[]): string {
  const body = rows.map((r) => `    <tr><td>${htmlEsc(r.line) || "&nbsp;"}</td><td>${htmlEsc(r.answer) || "&nbsp;"}</td></tr>`).join("\n");
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${htmlEsc(title)}</title>
<style>body{font:14px/1.7 system-ui,sans-serif;max-width:720px;margin:32px auto;padding:0 16px}table{border-collapse:collapse;width:100%}td{border-top:1px solid #ddd;padding:2px 12px;vertical-align:top}td:last-child{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}</style>
</head>
<body>
<h1>${htmlEsc(title)}</h1>
<table>
${body}
</table>
</body>
</html>
`;
}

// "line + answer" for copying: lines without an answer copy as-is.
export function copyLineText(line: string, answer: string): string {
  return answer ? `${line} = ${answer}` : line;
}

// Unformatted answer for pasting elsewhere: grouping commas and a leading
// currency symbol go away ("$1,234.56" -> "1234.56"); units, %, and words stay.
const LEADING_CUR = /^(-?)(?:[$€£¥₹₽₩฿₺₱₫₪₿Ξ]|(?:US|C|A|HK|R|MX|S|NZ)\$|CN¥|kr|Rp|RM|Kč|Ft|CHF|AED|zł)\s*/u;

export function plainAnswer(answer: string): string {
  if (!answer) return answer;
  return answer.replace(/,/g, "").replace(LEADING_CUR, "$1");
}
