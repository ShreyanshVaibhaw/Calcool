import type { RefObject } from "react";
import { s } from "./strings";

// Every keyboard shortcut in the app, grouped. Group copy lives in strings.ts;
// keep the key bindings in sync with editor.ts and App.tsx.

interface ShortcutsDialogProps {
  dialogRef: RefObject<HTMLDialogElement | null>;
}

export default function ShortcutsDialog({ dialogRef }: ShortcutsDialogProps) {
  return (
    <dialog
      ref={dialogRef}
      className="settings-dialog"
      aria-labelledby="shortcuts-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) dialogRef.current?.close();
      }}
    >
      <div className="settings-card">
        <header className="settings-header">
          <div>
            <h2 id="shortcuts-title">{s.shortcuts.title}</h2>
            <p>{s.shortcuts.subtitle}</p>
          </div>
          <button className="settings-close" type="button" aria-label={s.shortcuts.close} onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {s.shortcuts.groups.map((g) => (
          <section className="calc-settings" key={g.title} aria-label={g.title}>
            <h3>{g.title}</h3>
            <table className="shortcuts-table">
              <tbody>
                {g.rows.map(([keys, what]) => (
                  <tr key={keys + what}>
                    <th scope="row">{keys}</th>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </div>
    </dialog>
  );
}
