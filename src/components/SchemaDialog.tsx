import { useState } from "react";
import { executeSql } from "../api";
import { errorText, type Connection } from "../types";
import { schemaStatement, type SchemaInfo } from "../sql/schemas";

export type SchemaAction = {
  connection: Connection;
  database: string;
  mode: "create" | "rename" | "owner" | "delete";
  schema?: SchemaInfo;
};

export function SchemaDialog({ action, onClose, onSaved }: { action: SchemaAction; onClose: () => void; onSaved: () => void }) {
  const [value, setValue] = useState(action.mode === "owner" ? action.schema?.owner ?? "" : action.mode === "rename" ? action.schema?.name ?? "" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const title = { create: "New Schema", rename: "Rename Schema", owner: "Change Schema Owner", delete: "Delete Schema" }[action.mode];
  async function save() {
    setBusy(true);
    setError("");
    try {
      const sql = schemaStatement(action.connection.engine, action.mode, action.mode === "create" ? value : action.schema!.name, value);
      const result = await executeSql(action.connection.id, action.database, sql);
      const failed = result.messages.find((message) => message.level === "error");
      if (failed) throw new Error(failed.text);
      onSaved();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="overlay" onMouseDown={() => !busy && onClose()}>
      <form className="dialog small" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body">
          <p>{action.database}{action.schema ? ` / ${action.schema.name}` : ""}</p>
          {action.mode === "delete" ? <p>Delete this schema? It must be empty. Objects inside it will not be deleted.</p> : (
            <label>{action.mode === "owner" ? "Owner (database user or role)" : "Schema name"}
              <input autoFocus required disabled={busy} value={value} onChange={(event) => setValue(event.target.value)} />
            </label>
          )}
          {error ? <p className="dialog-error">{error}</p> : null}
        </div>
        <div className="dialog-actions">
          <button type="button" disabled={busy} onClick={onClose}>Cancel</button>
          <button type="submit" className="default" disabled={busy}>{busy ? "Applying..." : action.mode === "delete" ? "Delete" : "Save"}</button>
        </div>
      </form>
    </div>
  );
}
