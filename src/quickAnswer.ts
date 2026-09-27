import { evaluateSheet } from "./engine/sheet";
import { convertValue } from "./engine/evaluate";
import { formatValue } from "./engine/format";
import { unitById } from "./engine/units";

// QuickSoulver-style auto conversion for bare single entries: "21 miles" answers in km.
// Extracted from Quick.tsx so the mapping is unit-testable without React.
export const QUICK_AUTO: Record<string, string> = {
  mi: "km", km: "mi", kg: "lb", lb: "kg", g: "oz", oz: "g", C: "F", F: "C",
  ft: "m", m: "ft", cm: "inch", inch: "cm", l: "gal", gal: "l",
  mph: "kmh", kmh: "mph", yd: "m", nmi: "km", stone: "kg",
};

export function quickAnswer(text: string): string {
  const line = evaluateSheet(text).lines[0];
  if (!line || !line.value) return "";
  const v = line.value;
  const single = !/[+\-*/^%]|\bin\b|\bto\b|\bas\b/i.test(text);
  if (single && v.kind === "quantity") {
    const target = v.unit.category === "currency" ? (v.unit.id !== "USD" ? "USD" : null) : (QUICK_AUTO[v.unit.id] ?? null);
    if (target) {
      try {
        return formatValue(convertValue(v, { k: "unit", unit: unitById(target) }));
      } catch {
        // fall through to the plain answer
      }
    }
  }
  return line.formatted;
}
