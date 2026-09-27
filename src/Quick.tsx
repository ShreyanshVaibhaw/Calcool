import { useEffect, useMemo, useRef, useState } from "react";
import { quickAnswer } from "./quickAnswer";
import { loadRates } from "./rates";
import { s } from "./strings";
import "./App.css";

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
    void tick; // re-evaluate after loadRates refreshes currency
    return quickAnswer(text);
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
        placeholder={s.quick.placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        spellCheck={false}
      />
      {answer && <div className="quick-ans">{answer}</div>}
      {answer && <div className="quick-hint">{s.quick.copiesHint}</div>}
    </div>
  );
}
