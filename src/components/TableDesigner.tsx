import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { executeSql, listColumns, listObjects } from "../api";
import {
  buildTableStatements,
  columnCommentSql,
  decimalType,
  defaultIndexKind,
  engineTypes,
  formatColumnType,
  indexCatalogSql,
  indexKinds,
  integerType,
  parseColumnType,
  parseComments,
  parseIndexes,
  parseRelations,
  primaryKeyLookupSql,
  relationActions,
  relationCatalogSql,
  sizedType,
  uniqueIndexAllowed,
  type ColumnDraft,
  type IndexDraft,
  type RelationDraft,
} from "../sql/tableDesign";
import { errorText, type DbObject, type EngineKind } from "../types";
import { DeleteColumnIcon, DeleteIcon, InsertColumnIcon, InsertIcon, LinkIcon, SaveIcon, TableIcon, UniqueIcon } from "./Icons";

type Row = ColumnDraft & { key: string };
type IndexRow = IndexDraft & { key: string };
type RelationRow = RelationDraft & { key: string };
type DesignPane = "column" | "index" | "relation";

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
  const [pane, setPane] = useState<DesignPane>("column");
  const [indexes, setIndexes] = useState<IndexRow[]>([]);
  const [relations, setRelations] = useState<RelationRow[]>([]);
  const [previousIndexes, setPreviousIndexes] = useState<IndexDraft[]>([]);
  const [previousRelations, setPreviousRelations] = useState<RelationDraft[]>([]);
  const [indexId, setIndexId] = useState("");
  const [relationId, setRelationId] = useState("");
  const [tables, setTables] = useState<DbObject[]>([]);
  const [refColumns, setRefColumns] = useState<string[]>([]);

  useEffect(() => {
    const base = engineTypes(props.engine);
    setSchema(props.schema);
    setTableName(props.name);
    if (!props.name) {
      const first = blankRow(base[0]);
      setRows([first]);
      setPrevious([]);
      setIndexes([]);
      setRelations([]);
      setPreviousIndexes([]);
      setPreviousRelations([]);
      setIndexId("");
      setRelationId("");
      setSelected(first.key);
      setError("");
      return;
    }
    let cancel = false;
    void (async () => {
      try {
        const columns = await listColumns(props.connectionId, props.database, props.schema, props.name);
        if (cancel) return;
        const [commentRows, indexRows, relationRows] = await Promise.all([
          readCatalog(props.connectionId, props.database, columnCommentSql(props.engine, props.schema, props.name)).catch(() => []),
          readCatalog(props.connectionId, props.database, indexCatalogSql(props.engine, props.schema, props.name)).catch(() => []),
          readCatalog(props.connectionId, props.database, relationCatalogSql(props.engine, props.schema, props.name)).catch(() => []),
        ]);
        if (cancel) return;
        const comments = parseComments(commentRows);
        const loaded = columns.map((column) => {
          const row = fromInfo(column.name, column.dataType, column.nullable, column.primaryKey, base[0]);
          row.comment = comments.get(column.name.toLowerCase()) ?? "";
          return row;
        });
        const next = loaded.length ? withBlank(loaded) : [blankRow(base[0])];
        const loadedIndexes = parseIndexes(indexRows).map(indexRow);
        const loadedRelations = parseRelations(props.engine, relationRows).map(relationRow);
        setRows(next);
        setPrevious(loaded.map(draftOf));
        setIndexes(loadedIndexes);
        setPreviousIndexes(loadedIndexes.map(indexDraft));
        setRelations(loadedRelations);
        setPreviousRelations(loadedRelations.map(relationDraft));
        setIndexId(loadedIndexes[0]?.key ?? "");
        setRelationId(loadedRelations[0]?.key ?? "");
        setSelected(next[0]?.key ?? "");
        setError("");
      } catch (reason) {
        if (!cancel) setError(errorText(reason));
      }
    })();
    return () => {
      cancel = true;
    };
  }, [props.connectionId, props.database, props.engine, props.name, props.schema]);

  useEffect(() => {
    if (!props.connectionId || !props.database) return;
    let cancel = false;
    listObjects(props.connectionId, props.database)
      .then((objects) => {
        if (!cancel) setTables(objects.filter((object) => object.kind === "table"));
      })
      .catch(() => {
        if (!cancel) setTables([]);
      });
    return () => {
      cancel = true;
    };
  }, [props.connectionId, props.database]);

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
  const currentIndex = indexes.find((item) => item.key === indexId) ?? null;
  const currentRelation = relations.find((item) => item.key === relationId) ?? null;
  const namedColumns = rows.map((row) => row.name.trim()).filter((name) => name !== "");

  useEffect(() => {
    if (!currentRelation?.refTable || !props.connectionId) {
      setRefColumns([]);
      return;
    }
    let cancel = false;
    const database = props.engine === "mysql" && currentRelation.refSchema ? currentRelation.refSchema : props.database;
    const schemaName = props.engine === "mysql" ? props.database : currentRelation.refSchema;
    listColumns(props.connectionId, database, schemaName, currentRelation.refTable)
      .then((columns) => {
        if (!cancel) setRefColumns(columns.map((column) => column.name));
      })
      .catch(() => {
        if (!cancel) setRefColumns(currentRelation.refColumns);
      });
    return () => {
      cancel = true;
    };
  }, [props.connectionId, props.database, props.engine, currentRelation?.refSchema, currentRelation?.refTable]);
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
    if (patch.name === undefined) return;
    const from = rows.find((row) => row.key === key)?.name.trim() ?? "";
    const to = patch.name;
    if (!from || !to.trim() || from.toLowerCase() === to.toLowerCase()) return;
    const swap = (columns: string[]) => columns.map((column) => (column.toLowerCase() === from.toLowerCase() ? to : column));
    setIndexes((items) => items.map((item) => ({ ...item, columns: swap(item.columns) })));
    setRelations((items) => items.map((item) => ({ ...item, columns: swap(item.columns) })));
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

  function addIndex() {
    const row: IndexRow = {
      key: nextKey(),
      name: freshName("IX", props.name || tableName || "Table", indexes.map((item) => item.name)),
      originalName: "",
      unique: false,
      kind: defaultIndexKind(props.engine),
      columns: [],
    };
    setIndexes((items) => [...items, row]);
    setIndexId(row.key);
    setPane("index");
  }

  function addRelation() {
    const row: RelationRow = {
      key: nextKey(),
      name: freshName("FK", props.name || tableName || "Table", relations.map((item) => item.name)),
      originalName: "",
      columns: [],
      refSchema: props.engine === "mysql" ? "" : props.schema,
      refTable: "",
      refColumns: [],
      onDelete: "NO ACTION",
      onUpdate: "NO ACTION",
    };
    setRelations((items) => [...items, row]);
    setRelationId(row.key);
    setPane("relation");
  }

  function patchIndex(key: string, patch: Partial<IndexRow>) {
    setIndexes((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  function patchRelation(key: string, patch: Partial<RelationRow>) {
    setRelations((items) => items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
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

  function rememberSaved(columns: Row[]) {
    setRows((items) => withBlank(items.map((row) => (row.name.trim() ? { ...row, originalName: row.name } : row))));
    setPrevious(columns.map((column) => ({ ...draftOf(column), originalName: column.name })));
    setIndexes((items) => items.map((item) => ({ ...item, originalName: item.name.trim() })));
    setPreviousIndexes(indexes.map((item) => ({ ...indexDraft(item), originalName: item.name.trim() })));
    setRelations((items) => items.map((item) => ({ ...item, originalName: item.name.trim() })));
    setPreviousRelations(relations.map((item) => ({ ...relationDraft(item), originalName: item.name.trim() })));
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
      const creating = !props.name;
      let constraint = "";
      const keysChanged = !creating && pkList(previous) !== pkList(columns);
      if (keysChanged) {
        const lookup = await executeSql(props.connectionId, props.database, primaryKeyLookupSql(props.engine, schemaName, props.name), 20);
        const failed = lookup.messages.find((message) => message.level === "error");
        if (failed) throw new Error(failed.text);
        constraint = lookup.resultSets[0]?.rows[0]?.[0] ?? "";
      }
      const change = buildTableStatements({
        engine: props.engine,
        schema: schemaName,
        name: creating ? name : props.name,
        creating,
        previous,
        next: columns,
        primaryKey: constraint,
        previousIndexes,
        nextIndexes: indexes,
        previousRelations,
        nextRelations: relations,
      });
      if (change.error) throw new Error(change.error);
      if (change.statements.length) await runStatements(props.connectionId, props.database, change.statements);
      rememberSaved(columns);
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
          <InsertColumnIcon />
          <span>Insert Column</span>
        </button>
        <button type="button" title="Delete Column" disabled={busy || !current} onClick={deleteColumn}>
          <DeleteColumnIcon />
          <span>Delete Column</span>
        </button>
        <span className="spacer" />
        <button type="button" className="diagram-go" title="Save (Ctrl+S)" disabled={busy} onClick={() => void save(false)}>
          <SaveIcon />
          <span>{busy ? "Saving..." : "Save"}</span>
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
        <div className="td-tabs">
          <button type="button" className={pane === "column" ? "active" : ""} onClick={() => setPane("column")}>
            <TableIcon size={14} />
            Column
          </button>
          <button type="button" className={pane === "index" ? "active" : ""} onClick={() => setPane("index")}>
            <UniqueIcon size={14} />
            Indexes
          </button>
          <button type="button" className={pane === "relation" ? "active" : ""} onClick={() => setPane("relation")}>
            <LinkIcon size={14} />
            Relations
          </button>
        </div>
        {pane === "index" ? (
          <DesignList
            empty="No indexes yet."
            addLabel="Add Index"
            selected={indexId}
            rows={indexes.map((item) => ({
              key: item.key,
              title: item.name || "Index",
              detail: `${item.unique ? "Unique " : ""}${item.kind} (${item.columns.join(", ")})`,
            }))}
            onAdd={addIndex}
            onSelect={setIndexId}
            onDelete={() => {
              setIndexes((items) => items.filter((item) => item.key !== indexId));
              setIndexId("");
            }}
          >
            {currentIndex ? (
              <>
                <Property label="Name">
                  <input value={currentIndex.name} aria-label="Index name" onChange={(event) => patchIndex(currentIndex.key, { name: event.target.value })} />
                </Property>
                <Property label="Unique">
                  <select
                    value={currentIndex.unique ? "yes" : "no"}
                    disabled={!uniqueIndexAllowed(props.engine, currentIndex.kind)}
                    onChange={(event) => patchIndex(currentIndex.key, { unique: event.target.value === "yes" })}
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </select>
                </Property>
                <Property label="Type">
                  <select
                    value={currentIndex.kind}
                    aria-label="Index type"
                    onChange={(event) => {
                      const kind = event.target.value;
                      patchIndex(currentIndex.key, { kind, unique: uniqueIndexAllowed(props.engine, kind) ? currentIndex.unique : false });
                    }}
                  >
                    {indexOptions(props.engine, currentIndex.kind).map((kind) => (
                      <option key={kind} value={kind}>
                        {kind}
                      </option>
                    ))}
                  </select>
                </Property>
                <Property label="Columns">
                  <ColumnPicker
                    columns={namedColumns}
                    selected={currentIndex.columns}
                    onChange={(columns) => patchIndex(currentIndex.key, { columns })}
                  />
                </Property>
              </>
            ) : null}
          </DesignList>
        ) : null}
        {pane === "relation" ? (
          <DesignList
            empty="No relationships yet."
            addLabel="Add Relation"
            selected={relationId}
            rows={relations.map((item) => ({
              key: item.key,
              title: item.name || "Relation",
              detail: item.refTable ? `${item.columns.join(", ")} → ${item.refSchema ? `${item.refSchema}.` : ""}${item.refTable}` : "Choose a table",
            }))}
            onAdd={addRelation}
            onSelect={setRelationId}
            onDelete={() => {
              setRelations((items) => items.filter((item) => item.key !== relationId));
              setRelationId("");
            }}
          >
            {currentRelation ? (
              <>
                <Property label="Name">
                  <input value={currentRelation.name} aria-label="Relation name" onChange={(event) => patchRelation(currentRelation.key, { name: event.target.value })} />
                </Property>
                <Property label="Columns">
                  <ColumnPicker
                    columns={namedColumns}
                    selected={currentRelation.columns}
                    onChange={(columns) => patchRelation(currentRelation.key, { columns })}
                  />
                </Property>
                <Property label="Referenced Table">
                  <select
                    value={tableValue(currentRelation.refSchema, currentRelation.refTable)}
                    aria-label="Referenced table"
                    onChange={(event) => {
                      const [refSchema, refTable] = event.target.value.split("\0");
                      patchRelation(currentRelation.key, { refSchema: refSchema ?? "", refTable: refTable ?? "", refColumns: [] });
                    }}
                  >
                    <option value="">Choose a table</option>
                    {relationTables(tables, currentRelation).map((table) => (
                      <option key={tableValue(table.schema, table.name)} value={tableValue(table.schema, table.name)}>
                        {table.schema ? `${table.schema}.${table.name}` : table.name}
                      </option>
                    ))}
                  </select>
                </Property>
                <Property label="Referenced Columns">
                  <ColumnPicker
                    columns={refColumns}
                    selected={currentRelation.refColumns}
                    onChange={(columns) => patchRelation(currentRelation.key, { refColumns: columns })}
                  />
                </Property>
                <Property label="On Delete">
                  <select value={currentRelation.onDelete} onChange={(event) => patchRelation(currentRelation.key, { onDelete: event.target.value })}>
                    {actionOptions(props.engine, currentRelation.onDelete).map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </Property>
                <Property label="On Update">
                  <select value={currentRelation.onUpdate} onChange={(event) => patchRelation(currentRelation.key, { onUpdate: event.target.value })}>
                    {actionOptions(props.engine, currentRelation.onUpdate).map((action) => (
                      <option key={action} value={action}>
                        {action}
                      </option>
                    ))}
                  </select>
                </Property>
              </>
            ) : null}
          </DesignList>
        ) : null}
        {pane === "column" && current ? (
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
            <Property label="Comment">
              <textarea
                className="td-comment"
                value={current.comment}
                aria-label="Comment"
                onChange={(event) => update(current.key, { comment: event.target.value })}
              />
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
    comment: "",
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
    comment: "",
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
      comment: "",
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
    comment: row.comment,
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

async function readCatalog(connectionId: string, database: string, sql: string): Promise<Array<Array<string | null>>> {
  const response = await executeSql(connectionId, database, sql, 5000);
  const failed = response.messages.find((message) => message.level === "error");
  if (failed) throw new Error(failed.text);
  return response.resultSets[0]?.rows ?? [];
}

function indexRow(index: IndexDraft): IndexRow {
  return { ...index, key: nextKey() };
}

function relationRow(relation: RelationDraft): RelationRow {
  return { ...relation, key: nextKey() };
}

function indexDraft(index: IndexRow): IndexDraft {
  return { name: index.name, originalName: index.originalName, unique: index.unique, kind: index.kind, columns: index.columns };
}

function relationDraft(relation: RelationRow): RelationDraft {
  return {
    name: relation.name,
    originalName: relation.originalName,
    columns: relation.columns,
    refSchema: relation.refSchema,
    refTable: relation.refTable,
    refColumns: relation.refColumns,
    onDelete: relation.onDelete,
    onUpdate: relation.onUpdate,
  };
}

function freshName(prefix: string, table: string, used: string[]): string {
  const base = `${prefix}_${(table || "Table").replace(/[^\w]/g, "_")}`.slice(0, 50);
  const names = new Set(used.map((name) => name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  let index = 2;
  while (names.has(`${base}_${index}`.toLowerCase())) index += 1;
  return `${base}_${index}`;
}

function indexOptions(engine: EngineKind, current: string): string[] {
  const kinds = indexKinds(engine);
  return kinds.includes(current) ? kinds : [current, ...kinds];
}

function actionOptions(engine: EngineKind, current: string): string[] {
  const actions = relationActions(engine);
  return actions.includes(current) ? actions : [current, ...actions];
}

function tableValue(schema: string, name: string): string {
  if (!name) return "";
  return `${schema}\0${name}`;
}

function relationTables(tables: DbObject[], relation: RelationRow): DbObject[] {
  if (!relation.refTable || tables.some((table) => table.schema === relation.refSchema && table.name === relation.refTable)) return tables;
  return [{ schema: relation.refSchema, name: relation.refTable, kind: "table" }, ...tables];
}

function ColumnPicker(props: { columns: string[]; selected: string[]; onChange: (columns: string[]) => void }) {
  const available = props.columns.filter((column) => !props.selected.some((item) => item.toLowerCase() === column.toLowerCase()));
  function move(index: number, delta: number) {
    const next = props.selected.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    props.onChange(next);
  }
  return (
    <div className="td-chips">
      {props.selected.map((column, index) => (
        <span key={`${column}-${index}`} className="td-chip">
          <span>{column}</span>
          <button type="button" title="Move up" onClick={() => move(index, -1)}>↑</button>
          <button type="button" title="Move down" onClick={() => move(index, 1)}>↓</button>
          <button type="button" title="Remove" onClick={() => props.onChange(props.selected.filter((_, item) => item !== index))}>×</button>
        </span>
      ))}
      <select
        aria-label="Add column"
        value=""
        onChange={(event) => {
          if (event.target.value) props.onChange([...props.selected, event.target.value]);
        }}
      >
        <option value="">Add column</option>
        {available.map((column) => (
          <option key={column} value={column}>
            {column}
          </option>
        ))}
      </select>
    </div>
  );
}

function DesignList(props: {
  empty: string;
  addLabel: string;
  selected: string;
  rows: Array<{ key: string; title: string; detail: string }>;
  onAdd: () => void;
  onSelect: (key: string) => void;
  onDelete: () => void;
  children: ReactNode;
}) {
  return (
    <div className="td-editor">
      <div className="td-editor-bar">
        <button type="button" onClick={props.onAdd}>
          <InsertIcon />
          {props.addLabel}
        </button>
        <button type="button" disabled={!props.selected} onClick={props.onDelete}>
          <DeleteIcon />
          Delete
        </button>
      </div>
      {props.rows.length === 0 ? <div className="td-empty">{props.empty}</div> : null}
      {props.rows.length > 0 ? (
        <table className="td-mini">
          <tbody>
            {props.rows.map((row) => (
              <tr key={row.key} className={row.key === props.selected ? "selected" : ""} onMouseDown={() => props.onSelect(row.key)}>
                <td>{row.title}</td>
                <td>{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {props.children}
    </div>
  );
}
