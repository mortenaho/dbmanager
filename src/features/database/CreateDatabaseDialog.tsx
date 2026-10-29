import { useState } from "react";
import { createDatabase } from "../../shared/api";
import { errorText } from "../../shared/types";

export function CreateDatabaseDialog(props: {
  connectionId: string;
  onCancel: () => void;
  onCreated: (databases: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    const next = name.trim();
    if (!next) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const databases = await createDatabase(props.connectionId, next);
      props.onCreated(databases);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={props.onCancel}>
      <form
        className="dialog small"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-title">New Database</div>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="database-name">Database name</label>
            <input
              id="database-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          {error ? <p className="dialog-error">{error}</p> : null}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
          <button className="default" type="submit" disabled={busy}>
            {busy ? "Creating..." : "OK"}
          </button>
        </div>
      </form>
    </div>
  );
}
