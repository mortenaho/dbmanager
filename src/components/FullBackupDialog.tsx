import { useState } from "react";
import { fullBackup } from "../api";
import { errorText } from "../types";

export function FullBackupDialog(props: {
  connectionId: string;
  database: string;
  onCancel: () => void;
  onCompleted: (path: string) => void;
}) {
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    const target = path.trim();
    if (!target.toLowerCase().endsWith(".bak")) {
      setError("Enter a server file path ending in .bak.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await fullBackup(props.connectionId, props.database, target);
      props.onCompleted(target);
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={() => !busy && props.onCancel()}>
      <form className="dialog small" onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <div className="dialog-title">Full Backup (.bak) · {props.database}</div>
        <div className="dialog-body">
          <p>The file is created on the SQL Server host. Enter a full path in an existing folder that SQL Server can write to.</p>
          <div className="field">
            <label htmlFor="backup-path">Server backup file path</label>
            <input id="backup-path" autoFocus value={path} disabled={busy}
              placeholder="/var/opt/mssql/backup/database.bak"
              onChange={(event) => setPath(event.target.value)} />
          </div>
          <p>Creates a copy-only full backup. Existing backup sets in the file are preserved.</p>
          {error ? <div className="dialog-error">{error}</div> : null}
        </div>
        <div className="dialog-actions">
          <button type="submit" className="default" disabled={busy}>{busy ? "Backing up..." : "Back Up"}</button>
          <button type="button" disabled={busy} onClick={props.onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
