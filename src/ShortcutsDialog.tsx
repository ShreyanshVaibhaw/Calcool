import type { RefObject } from "react";

// Every keyboard shortcut in the app, grouped. Keep in sync with editor.ts and App.tsx.
const GROUPS: { title: string; rows: [string, string][] }[] = [
  {
    title: "Find and navigate",
    rows: [
      ["Ctrl+F", "Find in this sheet"],
      ["Ctrl+H", "Find and replace"],
      ["Ctrl+G", "Go to line"],
      ["Esc", "Close the find panel or dialog"],
    ],
  },
  {
    title: "Edit lines",
    rows: [
      ["Ctrl+D", "Duplicate the selected lines"],
      ["Ctrl+/", "Comment the selected lines"],
      ["Ctrl+T", "Insert a total line below"],
      ["Ctrl+Space", "Autocomplete a variable or unit"],
      ["Alt+drag / Alt+scroll", "Scrub the number under the cursor"],
      ["Ctrl+Z / Ctrl+Y", "Undo / redo (one drag is one undo)"],
    ],
  },
  {
    title: "Variables and references",
    rows: [
      ["F2 or Ctrl+R", "Rename the variable under the cursor everywhere"],
      ["Ctrl+L", "Insert a live reference to a line number"],
      ["Ctrl+\\", "Insert a reference to the nearest answer above"],
      ["Double-click an answer", "Insert a reference to it (drag works too)"],
      ["Type an operator on an empty line", "References the previous answer"],
    ],
  },
  {
    title: "Sheets and app",
    rows: [
      ["Ctrl+N", "New sheet"],
      ["Ctrl+\\", "Show or hide the sheet sidebar"],
      ["Ctrl+,", "Open settings"],
      ["Double-click a sheet title", "Rename it (empty reverts to auto)"],
    ],
  },
  {
    title: "Quick popup",
    rows: [
      ["Alt+Space", "Open the quick calculator (falls back when a launcher owns it)"],
      ["Enter", "Copy the answer and close"],
      ["Esc", "Close without copying"],
    ],
  },
];

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
            <h2 id="shortcuts-title">Keyboard shortcuts</h2>
            <p>Every shortcut in Calcool, in one place.</p>
          </div>
          <button className="settings-close" type="button" aria-label="Close shortcuts" onClick={() => dialogRef.current?.close()}>
            ×
          </button>
        </header>
        {GROUPS.map((g) => (
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
