import { useEffect, useMemo, useRef, useState } from "react";
import { evaluateSheet } from "./engine/sheet";
import { convertValue } from "./engine/evaluate";
import { formatValue } from "./engine/format";
import { unitById } from "./engine/units";
import { loadRates } from "./rates";
import "./App.css";

// QuickSoulver-style auto conversion for bare single entries: "21 miles" answers in km
const AUTO: Record<string, string> = {
  mi: "km", km: "mi", kg: "lb", lb: "kg", g: "oz", oz: "g", C: "F", F: "C",
  ft: "m", m: "ft", cm: "inch", inch: "cm", l: "gal", gal: "l",
  mph: "kmh", kmh: "mph", yd: "m", nmi: "km", stone: "kg",
};

async function hideWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  } catch {
    // browser dev: nothing to hide
  }
}

export default function Quick() {
  const [text, setText] = useState("");
  const [tick, setTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadRates(() => setTick((t) => t + 1));
    let un: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWindow } = await import("@tauri-apps/api/window");
        un = await getCurrentWindow().listen("tauri://focus", () => inputRef.current?.select());
      } catch {
        // browser dev
      }
    })();
    return () => un?.();
  }, []);

  const answer = useMemo(() => {
    void tick;
    const line = evaluateSheet(text).lines[0];
    if (!line || !line.value) return "";
    const v = line.value;
    const single = !/[+\-*/^%]|\bin\b|\bto\b|\bas\b/i.test(text);
    if (single && v.kind === "quantity") {
      const target = v.unit.category === "currency" ? (v.unit.id !== "USD" ? "USD" : null) : (AUTO[v.unit.id] ?? null);
      if (target) {
        try {
          return formatValue(convertValue(v, { k: "unit", unit: unitById(target) }));
        } catch {
          // fall through to the plain answer
        }
      }
    }
    return line.formatted;
  }, [text, tick]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setText("");
      hideWindow();
    } else if (e.key === "Enter" && answer) {
      navigator.clipboard.writeText(answer).catch(() => {});
      setText("");
      hideWindow();
    }
  };

  return (
    <div className="quick">
      <input
        ref={inputRef}
        className="quick-in"
        autoFocus
        placeholder="Type a calculation…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
      />
      {answer && <div className="quick-ans">{answer}</div>}
      {answer && <div className="quick-hint">↵ copies</div>}
    </div>
  );
}
