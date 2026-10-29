import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { executeSql, listColumns } from "../api";
import {
  alterTableSql,
  createTableSql,
  decimalType,
  engineTypes,
  formatColumnType,
  integerType,
  parseColumnType,
  primaryKeyLookupSql,
  sizedType,
  type ColumnDraft,
} from "../sql/tableDesign";
import { errorText, type EngineKind } from "../types";

type Row = ColumnDraft & { key: string };

export function TableDesigner(props: {
  connectionId: string;
  engine: EngineKind;
  database: string;
  schema: string;
  name: string;
  onSaved: (schema: string, name: string) => void;
}) {
  const types = engineTypes(props.engine);
  const [rows, setRows] = useState<Row[]>(() => [blankRow(types[0])]);
  const [previous, setPrevious] = useState<ColumnDraft[]>([]);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [naming, setNaming] = useState(false);
  const [schema, setSchema] = useState(props.schema);
  const [tableName, setTableName] = useState(props.name);
  const [gridHeight, setGridHeight] = useState(280);

  useEffect(() => {
    const base = engineTypes(props.engine);
    setSchema(props.schema);
    setTableName(props.name);
    if (!props.name) {
      const first = blankRow(base[0]);
      setRows([first]);
      setPrevious([]);
      setSelected(first.key);
      setError("");
      return;
    }
    let cancel = false;
    listColumns(props.connectionId, props.database, props.schema, props.name)
      .then((columns) => {
        if (cancel) return;
        const loaded = columns.map((column) => fromInfo(column.name, column.dataType, column.nullable, column.primaryKey, base[0]));
        const next = loaded.length ? withBlank(loaded) : [blankRow(base[0])];
        setRows(next);
        setPrevious(loaded.map(draftOf));
        setSelected(next[0]?.key ?? "");
        setError("");
      })
      .catch((reason) => {
        if (!cancel) setError(errorText(reason));
      });
    return () => {
      cancel = true;
    };
  }, [props.connectionId, props.database, props.engine, props.name, props.schema]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save(naming);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const current = rows.find((row) => row.key === selected) ?? rows[0];
  const knownTypes = useMemo(() => {
    const extra = rows.map((row) => row.dataType).filter((type) => type && !types.includes(type));
    return [...types, ...new Set(extra)];
  }, [rows, types]);

  function update(key: string, patch: Partial<Row>) {
    setRows((items) => {
      const next = items.map((row) => {
        if (row.key !== key) return row;
        const merged = { ...row, ...patch };
        if (patch.dataType && sizedType(patch.dataType) && !row.length) merged.length = 50;
        if (patch.dataType && decimalType(patch.dataType)) {
          if (!row.precision) merged.precision = 18;
          if (!row.scale) merged.scale = 0;
        }
        if (patch.dataType && !integerType(patch.dataType)) merged.identity = false;
        if (merged.primaryKey || merged.identity) merged.nullable = false;
        return merged;
      });
      return withBlank(next);
    });
  }

  function toggleKey(key: string) {
    setRows((items) =>
      withBlank(
        items.map((row) => {
          if (row.key !== key || !row.name.trim()) return row;
          const primaryKey = !row.primaryKey;
          return { ...row, primaryKey, nullable: primaryKey ? false : row.nullable };
        }),
      ),
    );
  }

  function insertColumn() {
    const row = blankRow(types[0]);
    setRows((items) => {
      const index = Math.max(0, items.findIndex((item) => item.key === selected));
      const next = items.slice();
      next.splice(index, 0, row);
      return next;
    });
    setSelected(row.key);
  }

  function deleteColumn() {
    setRows((items) => {
      const next = items.filter((row) => row.key !== selected);
      return withBlank(next.length ? next : [blankRow(types[0])]);
    });
  }

  function startSplit(event: ReactMouseEvent) {
    event.preventDefault();
    const startY = event.clientY;
    const startH = gridHeight;
    const move = (moveEvent: MouseEvent) => setGridHeight(Math.max(120, Math.min(560, startH + moveEvent.clientY - startY)));
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  async function save(force: boolean) {
    const columns = rows.filter((row) => row.name.trim());
    if (!columns.length) {
      setError("Add at least one column.");
      return;
    }
    if (!props.name && !force) {
      setNaming(true);
      setTableName("");
      return;
    }
    const name = (force ? tableName : props.name).trim();
    const schemaName = props.engine === "mysql" ? props.database : (force ? schema : props.schema).trim();
    if (!name) {
      setError("Table name is required.");
      return;
    }
    if (!props.connectionId) {
      setError("Connect to a database before saving the table.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (!props.name) {
        await runStatements(props.connectionId, props.database, [createTableSql(props.engine, schemaName, name, columns)]);
      } else {
        let constraint = "";
        const keysChanged = pkList(previous) !== pkList(columns);
        if (keysChanged) {
          const lookup = await executeSql(props.connectionId, props.database, primaryKeyLookupSql(props.engine, schemaName, props.name), 20);
          const failed = lookup.messages.find((message) => message.level === "error");
          if (failed) throw new Error(failed.text);
          constraint = lookup.resultSets[0]?.rows[0]?.[0] ?? "";
        }
        const change = alterTableSql(props.engine, schemaName, props.name, previous, columns, constraint);
        if (change.error) throw new Error(change.error);
        if (change.statements.length) await runStatements(props.connectionId, props.database, change.statements);
      }
      setNaming(false);
      props.onSaved(schemaName, name);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="table-design">
      <div className="table-design-bar">
        <button type="button" title="Set Primary Key" disabled={!current?.name.trim() || busy} onClick={() => current && toggleKey(current.key)}>
          <KeyIcon />
          <span>Primary Key</span>
        </button>
        <button type="button" title="Insert Column" disabled={busy} onClick={insertColumn}>
          Insert Column
        </button>
        <button type="button" title="Delete Column" disabled={busy || !current} onClick={deleteColumn}>
          Delete Column
        </button>
        <span className="spacer" />
        <button type="button" className="diagram-go" title="Save (Ctrl+S)" disabled={busy} onClick={() => void save(false)}>
          {busy ? "Saving..." : "Save"}
        </button>
      </div>
      <div className="td-grid" style={{ height: gridHeight }}>
        <table className="td-table">
          <thead>
            <tr>
              <th className="td-gutter" />
              <th>Column Name</th>
              <th>Data Type</th>
              <th className="td-null">Allow Nulls</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className={row.key === current?.key ? "selected" : ""} onMouseDown={() => setSelected(row.key)}>
                <td className="td-gutter">{row.primaryKey ? <KeyIcon /> : null}</td>
                <td>
                  <input
                    value={row.name}
                    aria-label="Column Name"
                    onChange={(event) => update(row.key, { name: event.target.value })}
                  />
                </td>
                <td>
                  <select aria-label="Data Type" value={row.dataType} onChange={(event) => update(row.key, { dataType: event.target.value })}>
                    {knownTypes.map((type) => (
                      <option key={type} value={type}>
                        {type === row.dataType ? formatColumnType(row) : type}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="td-null">
                  <input
                    type="checkbox"
                    aria-label="Allow Nulls"
                    checked={row.nullable}
                    disabled={row.primaryKey || row.identity}
                    onChange={(event) => update(row.key, { nullable: event.target.checked })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="splitter-h" onMouseDown={startSplit} />
      <div className="td-props">
        <div className="td-caption">Column Properties</div>
        {current ? (
          <>
            <div className="td-group">(General)</div>
            <Property label="(Name)">
              <input value={current.name} onChange={(event) => update(current.key, { name: event.target.value })} />
            </Property>
            <Property label="Data Type">
              <select value={current.dataType} onChange={(event) => update(current.key, { dataType: event.target.value })}>
                {knownTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </Property>
            <Property label="Length">
              <input
                value={sizedType(current.dataType) ? String(current.length || "") : ""}
                disabled={!sizedType(current.dataType)}
                onChange={(event) => update(current.key, { length: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })}
              />
            </Property>
            <Property label="Precision">
              <input
                value={decimalType(current.dataType) ? String(current.precision || "") : ""}
                disabled={!decimalType(current.dataType)}
                onChange={(event) => update(current.key, { precision: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })}
              />
            </Property>
            <Property label="Scale">
              <input
                value={decimalType(current.dataType) ? String(current.scale || "") : ""}
                disabled={!decimalType(current.dataType)}
                onChange={(event) => update(current.key, { scale: Number(event.target.value.replace(/[^\d]/g, "")) || 0 })}
              />
            </Property>
            <Property label="Allow Nulls">
              <select
                value={current.nullable ? "yes" : "no"}
                disabled={current.primaryKey || current.identity}
                onChange={(event) => update(current.key, { nullable: event.target.value === "yes" })}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Property>
            <Property label="Default Value or Binding">
              <input value={current.defaultValue} onChange={(event) => update(current.key, { defaultValue: event.target.value })} />
            </Property>
            <div className="td-group">Identity Specification</div>
            <Property label="(Is Identity)">
              <select
                value={current.identity ? "yes" : "no"}
                disabled={!integerType(current.dataType)}
                onChange={(event) => update(current.key, { identity: event.target.value === "yes", nullable: event.target.value === "yes" ? false : current.nullable })}
              >
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </Property>
            <Property label="Identity Increment">
              <input
                value={current.identity ? String(current.increment || 1) : ""}
                disabled={!current.identity}
                onChange={(event) => update(current.key, { increment: Number(event.target.value.replace(/[^\d]/g, "")) || 1 })}
              />
            </Property>
            <Property label="Identity Seed">
              <input
                value={current.identity ? String(current.seed || 1) : ""}
                disabled={!current.identity}
                onChange={(event) => update(current.key, { seed: Number(event.target.value.replace(/[^\d]/g, "")) || 1 })}
              />
            </Property>
          </>
        ) : null}
        {error ? <p className="dialog-error">{error}</p> : null}
      </div>
      {naming ? (
        <div className="overlay" onMouseDown={() => setNaming(false)}>
          <form
            className="dialog small"
            onMouseDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              void save(true);
            }}
          >
            <div className="dialog-title">Choose Name</div>
            <div className="dialog-body">
              <p>Enter a name for the table.</p>
              {props.engine === "mysql" ? null : (
                <div className="field">
                  <label>Schema</label>
                  <input value={schema} onChange={(event) => setSchema(event.target.value)} />
                </div>
              )}
              <div className="field">
                <label>Table</label>
                <input value={tableName} autoFocus onChange={(event) => setTableName(event.target.value)} />
              </div>
              {error ? <p className="dialog-error">{error}</p> : null}
            </div>
            <div className="dialog-actions">
              <button type="button" onClick={() => setNaming(false)} disabled={busy}>
                Cancel
              </button>
              <button className="default" type="submit" disabled={busy}>
                OK
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function blankRow(dataType: string): Row {
  return {
    key: nextKey(),
    name: "",
    originalName: "",
    dataType,
    length: sizedType(dataType) ? 50 : 0,
    precision: 18,
    scale: 0,
    nullable: true,
    primaryKey: false,
    identity: false,
    seed: 1,
    increment: 1,
    defaultValue: "",
  };
}

function fromInfo(name: string, dataType: string, nullable: boolean, primaryKey: boolean, fallback: string): Row {
  const parsed = parseColumnType(dataType);
  return {
    key: nextKey(),
    name,
    originalName: name,
    dataType: parsed.dataType || fallback,
    length: parsed.length,
    precision: parsed.precision,
    scale: parsed.scale,
    nullable: primaryKey ? false : nullable,
    primaryKey,
    identity: false,
    seed: 1,
    increment: 1,
    defaultValue: "",
  };
}

let rowSerial = 1;

function nextKey(): string {
  rowSerial += 1;
  return `c${rowSerial}`;
}

function Property(props: { label: string; children: ReactNode }) {
  return (
    <div className="td-prop">
      <span>{props.label}</span>
      <div className="td-value">{props.children}</div>
    </div>
  );
}

function KeyIcon() {
  return (
    <svg className="td-key" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path
        fill="#c8960a"
        d="M6.2 1.4a3.1 3.1 0 0 1 1.2 6l.2.2 1.1-.1.7.8-.8.8.9.1.6.7-1 .9H7.4l-.5-1.5A3.1 3.1 0 1 1 6.2 1.4zm.1 1.6a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z"
      />
    </svg>
  );
}

function withBlank(rows: Row[]): Row[] {
  const last = rows[rows.length - 1];
  if (last && !last.name.trim() && !last.originalName) return rows;
  const source = rows[0];
  return [
    ...rows,
    {
      key: nextKey(),
      name: "",
      originalName: "",
      dataType: source?.dataType ?? "int",
      length: sizedType(source?.dataType ?? "") ? 50 : 0,
      precision: 18,
      scale: 0,
      nullable: true,
      primaryKey: false,
      identity: false,
      seed: 1,
      increment: 1,
      defaultValue: "",
    },
  ];
}

function draftOf(row: Row): ColumnDraft {
  return {
    name: row.name,
    originalName: row.originalName,
    dataType: row.dataType,
    length: row.length,
    precision: row.precision,
    scale: row.scale,
    nullable: row.nullable,
    primaryKey: row.primaryKey,
    identity: row.identity,
    seed: row.seed,
    increment: row.increment,
    defaultValue: row.defaultValue,
  };
}

function pkList(columns: Array<Pick<ColumnDraft, "name" | "primaryKey">>): string {
  return columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name.toLowerCase())
    .join("\0");
}

async function runStatements(connectionId: string, database: string, statements: string[]) {
  for (const statement of statements) {
    const response = await executeSql(connectionId, database, statement, 20);
    const failed = response.messages.find((message) => message.level === "error");
    if (failed) throw new Error(failed.text);
  }
}
