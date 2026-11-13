import { useEffect, useState } from "react";
import { createDatabase, executeSql } from "../api";
import { SearchableSelect } from "./SearchableSelect";
import { errorText, type Connection } from "../types";

export function CreateDatabaseDialog(props: {
  connectionId: string;
  connection: Connection;
  onCancel: () => void;
  onCreated: (databases: string[]) => void;
}) {
  const [name, setName] = useState("");
  const [collation, setCollation] = useState("Server default");
  const [options, setOptions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let cancelled = false;
    const sql = props.connection.engine === "mssql"
      ? "SELECT name FROM sys.fn_helpcollations() ORDER BY name"
      : props.connection.engine === "mysql"
        ? "SELECT COLLATION_NAME FROM information_schema.COLLATIONS ORDER BY COLLATION_NAME"
        : "SELECT DISTINCT pg_encoding_to_char(conforencoding) AS name FROM pg_conversion ORDER BY name";
    setLoading(true);
    setLoadError("");
    executeSql(props.connectionId, props.connection.database, sql, 10000)
      .then((result) => {
        if (cancelled) return;
        const failure = result.messages.find((message) => message.level === "error");
        if (failure) throw new Error(failure.text);
        setOptions(result.resultSets[0]?.rows.map((row) => row[0]).filter((value): value is string => Boolean(value)) ?? []);
      })
      .catch((reason) => { if (!cancelled) setLoadError(errorText(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.connectionId, props.connection.database, props.connection.engine]);
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
      const databases = await createDatabase(props.connectionId, next, collation === "Server default" ? undefined : collation);
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
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="field">
            <label>{props.connection.engine === "postgres" ? "Encoding / Unicode" : "Collation / Unicode"}</label>
            <SearchableSelect
              value={collation}
              options={["Server default", ...options]}
              ariaLabel={props.connection.engine === "postgres" ? "Encoding / Unicode" : "Collation / Unicode"}
              width={360}
              disabled={busy || loading}
              onChange={setCollation}
            />
            {loading ? <small>Loading options...</small> : null}
            {loadError ? <div className="dialog-error">{loadError}</div> : null}
          </div>
          {error ? <div className="dialog-error">{error}</div> : null}
        </div>
        <div className="dialog-actions">
          <button type="submit" className="default" disabled={busy}>
            {busy ? "Creating..." : "OK"}
          </button>
          <button type="button" onClick={props.onCancel} disabled={busy}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
