type Props = {
  onClose: () => void;
};

const SECTIONS: Array<{ title: string; rows: Array<{ action: string; keys: string[] }> }> = [
  {
    title: "Query",
    rows: [
      { action: "Execute", keys: ["F5", "Ctrl+E"] },
      { action: "Parse", keys: ["Ctrl+F5"] },
      { action: "Format SQL", keys: ["Shift+Alt+F"] },
      { action: "New query", keys: ["Ctrl+N"] },
      { action: "Close query", keys: ["Ctrl+W"] },
    ],
  },
  {
    title: "Editor",
    rows: [
      { action: "Undo", keys: ["Ctrl+Z"] },
      { action: "Redo", keys: ["Ctrl+Y"] },
      { action: "Suggestions", keys: ["Ctrl+Space"] },
      { action: "Find", keys: ["Ctrl+F"] },
      { action: "Snippets", keys: ["sel, ins, upd, join"] },
    ],
  },
  {
    title: "Results",
    rows: [
      { action: "Select cells", keys: ["Drag"] },
      { action: "Select rows or columns", keys: ["Headers"] },
      { action: "Select all results", keys: ["Ctrl+A"] },
      { action: "Copy with headers", keys: ["Ctrl+C"] },
      { action: "Copy without headers", keys: ["Ctrl+Shift+C"] },
      { action: "Save as Excel", keys: ["Results bar"] },
      { action: "Save as JSON", keys: ["Results bar"] },
    ],
  },
  {
    title: "Window",
    rows: [
      { action: "Keyboard shortcuts", keys: ["F1"] },
      { action: "Close a dialog", keys: ["Esc"] },
      { action: "History", keys: ["View menu"] },
      { action: "Options", keys: ["Tools menu"] },
    ],
  },
];

export function HelpDialog({ onClose }: Props) {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog help" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">Keyboard Shortcuts</div>
        <div className="dialog-body help-body">
          <p className="help-lead">DB Manager shortcuts for queries, the editor, and results.</p>
          <div className="help-grid">
            {SECTIONS.map((section) => (
              <section key={section.title} className="help-section">
                <h3>{section.title}</h3>
                {section.rows.map((row) => (
                  <div key={`${section.title}-${row.action}`} className="shortcut-row">
                    <span>{row.action}</span>
                    <span className="shortcut-keys">
                      {row.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
        <div className="dialog-actions">
          <span className="help-credit">DB Manager · MoriX</span>
          <span className="spacer" />
          <button className="default" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
