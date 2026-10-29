import { useEffect, useState } from "react";
import { listColumns, saveTable, type TableColumnPayload } from "../../shared/api";
import { errorText, type EngineKind } from "../../shared/types";

type Row = {
  key: string;
  originalName: string;
  name: string;
  dataType: string;
  length: string;
  nullable: boolean;
  primaryKey: boolean;
};

const TYPES: Record<EngineKind, string[]> = {
  mssql: ["int", "bigint", "bit", "decimal", "float", "date", "datetime", "nvarchar", "varchar", "uniqueidentifier"],
  postgres: ["integer", "bigint", "boolean", "numeric", "real", "double precision", "date", "timestamp", "text", "varchar", "uuid"],
  mysql: ["int", "bigint", "tinyint", "decimal", "double", "date", "datetime", "varchar", "text"],
};

const SIZED = new Set(["nvarchar", "varchar", "nchar", "char"]);

export function TableDesigner(props: {
  connectionId: string;
  engine: EngineKind;
  database: string;
  schema: string;
  name: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const existing = props.name.trim() !== "";
  const types = TYPES[props.engine];
  const [schema, setSchema] = useState(props.schema);
  const [tableName, setTableName] = useState(props.name);
  const [rows, setRows] = useState<Row[]>([blank(types[0])]);
  const [previous, setPrevious] = useState<TableColumnPayload[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existing) return;
    let cancel = false;
    listColumns(props.connectionId, props.database, props.schema, props.name)
      .then((columns) => {
        if (cancel) return;
        const loaded = columns.map((column) => fromInfo(column.name, column.dataType, column.nullable, column.primaryKey, types));
        setRows(loaded.length ? loaded : [blank(types[0])]);
        setPrevious(loaded.map(toPayload));
      })
      .catch((reason) => {
        if (!cancel) setError(errorText(reason));
      });
    return () => {
      cancel = true;
    };
  }, [existing, props.connectionId, props.database, props.engine, props.name, props.schema, types]);

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  async function submit() {
    const columns = rows.filter((row) => row.name.trim() || row.dataType.trim());
    if (!tableName.trim()) {
      setError("Table name is required.");
      return;
    }
    if (!columns.length) {
      setError("Add at least one column.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveTable({
        connectionId: props.connectionId,
        database: props.database,
        schema: props.engine === "mysql" ? props.database : schema.trim(),
        name: tableName.trim(),
        originalName: existing ? props.name : "",
        previous: existing ? previous : [],
        columns: columns.map(toPayload),
      });
      props.onSaved();
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  return (
    <div className="overlay" onMouseDown={props.onClose}>
      <form
        className="dialog designer"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="dialog-title">{existing ? "Design Table" : "New Table"}</div>
        <div className="dialog-body">
          <div className="designer-fields">
            {props.engine === "mysql" ? null : (
              <label>
                Schema
                <input value={schema} onChange={(event) => setSchema(event.target.value)} />
              </label>
            )}
            <label>
              Table
              <input value={tableName} autoFocus onChange={(event) => setTableName(event.target.value)} />
            </label>
            <span className="designer-db">{props.database}</span>
          </div>
          <div className="designer-grid">
            <div className="designer-head">
              <span>Name</span>
              <span>Data Type</span>
              <span>Length</span>
              <span>Allow Nulls</span>
              <span>Primary Key</span>
              <span />
            </div>
            {rows.map((row) => (
              <div className="designer-line" key={row.key}>
                <input value={row.name} onChange={(event) => update(row.key, { name: event.target.value })} />
                <select value={row.dataType} onChange={(event) => update(row.key, { dataType: event.target.value })}>
                  {types.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <input
                  value={row.length}
                  disabled={!SIZED.has(row.dataType)}
                  onChange={(event) => update(row.key, { length: event.target.value.replace(/[^\d]/g, "") })}
                />
                <input
                  type="checkbox"
                  checked={row.nullable}
                  onChange={(event) => update(row.key, { nullable: event.target.checked })}
                />
                <input
                  type="checkbox"
                  checked={row.primaryKey}
                  disabled={existing}
                  onChange={(event) =>
                    update(row.key, { primaryKey: event.target.checked, nullable: event.target.checked ? false : row.nullable })
                  }
                />
                <button
                  type="button"
                  onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
          <button type="button" onClick={() => setRows((current) => [...current, blank(types[0])])}>
            Add Column
          </button>
          {error ? <p className="dialog-error">{error}</p> : null}
        </div>
        <div className="dialog-actions">
          <button type="button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="default" type="submit" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function blank(dataType: string): Row {
  return {
    key: crypto.randomUUID(),
    originalName: "",
    name: "",
    dataType,
    length: dataType === "varchar" || dataType === "nvarchar" ? "50" : "",
    nullable: true,
    primaryKey: false,
  };
}

function fromInfo(name: string, dataType: string, nullable: boolean, primaryKey: boolean, types: string[]): Row {
  const parsed = parseType(dataType);
  const known = types.find((type) => type === parsed.dataType) ?? types[0];
  return {
    key: crypto.randomUUID(),
    originalName: name,
    name,
    dataType: types.includes(parsed.dataType) ? parsed.dataType : known,
    length: parsed.length,
    nullable,
    primaryKey,
  };
}

function parseType(value: string): { dataType: string; length: string } {
  const trimmed = value.trim().toLowerCase();
  const varying = /^character varying(?:\((\d+)\))?/.exec(trimmed);
  if (varying) return { dataType: "varchar", length: varying[1] ?? "" };
  if (trimmed.startsWith("timestamp")) return { dataType: "timestamp", length: "" };
  const sized = /^([a-z ]+?)\((\d+)/.exec(trimmed);
  if (sized) return { dataType: sized[1].trim(), length: sized[2] };
  return { dataType: trimmed.split("(")[0].trim(), length: "" };
}

function toPayload(row: Row): TableColumnPayload {
  return {
    name: row.name.trim(),
    originalName: row.originalName,
    dataType: row.dataType,
    length: Number(row.length) || 0,
    nullable: row.primaryKey ? false : row.nullable,
    primaryKey: row.primaryKey,
  };
}
