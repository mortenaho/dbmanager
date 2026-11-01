import { useEffect, useMemo, useState } from "react";
import { listObjects } from "../api";
import { errorText, type DbObject, type EngineKind } from "../types";

export type ScriptGenerateOptions = {
  includeCreate: boolean;
  includeData: boolean;
  includeDatabase: boolean;
  includeSchemas: boolean;
  includeTables: boolean;
  includeViews: boolean;
  includeProcedures: boolean;
  includeFunctions: boolean;
  selected: Array<{ schema: string; name: string; kind: string }> | null;
};

type Props = {
  connectionId: string;
  database: string;
  engine: EngineKind;
  object: DbObject | null;
  preset: "schema" | "backup" | "custom";
  onCancel: () => void;
  onGenerate: (options: ScriptGenerateOptions) => Promise<void>;
};

function defaults(preset: Props["preset"], object: DbObject | null): ScriptGenerateOptions {
  const backup = preset === "backup";
  const single = object != null;
  return {
    includeCreate: true,
    includeData: backup,
    includeDatabase: !single,
    includeSchemas: !single,
    includeTables: !single || object?.kind === "table",
    includeViews: !single || object?.kind === "view",
    includeProcedures: !single || object?.kind === "procedure",
    includeFunctions: !single || object?.kind === "function",
    selected: single
      ? [{ schema: object.schema, name: object.name, kind: object.kind }]
      : null,
  };
}

export function ScriptDialog({
  connectionId,
  database,
  engine,
  object,
  preset,
  onCancel,
  onGenerate,
}: Props) {
  const [options, setOptions] = useState(() => defaults(preset, object));
  const [objects, setObjects] = useState<DbObject[]>([]);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(object == null);
  const databaseMode = object == null;
  const supportsSchemas = engine !== "mysql";

  useEffect(() => {
    if (!databaseMode) return;
    let cancel = false;
    setLoading(true);
    listObjects(connectionId, database)
      .then((items) => {
        if (cancel) return;
        setObjects(items);
        setOptions((current) => ({
          ...current,
          selected: items.map((item) => ({
            schema: item.schema,
            name: item.name,
            kind: item.kind,
          })),
        }));
      })
      .catch((reason) => {
        if (!cancel) setError(errorText(reason));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [connectionId, database, databaseMode]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return objects.filter((item) => {
      if (item.kind === "table" && !options.includeTables) return false;
      if (item.kind === "view" && !options.includeViews) return false;
      if (item.kind === "procedure" && !options.includeProcedures) return false;
      if (item.kind === "function" && !options.includeFunctions) return false;
      if (!needle) return true;
      return `${item.schema}.${item.name} ${item.kind}`.toLowerCase().includes(needle);
    });
  }, [objects, options, filter]);

  const selectedKeys = useMemo(() => {
    const set = new Set(
      (options.selected ?? []).map((item) => keyOf(item.schema, item.name, item.kind)),
    );
    return set;
  }, [options.selected]);

  function patch(partial: Partial<ScriptGenerateOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }

  function toggleObject(item: DbObject, checked: boolean) {
    setOptions((current) => {
      const existing = current.selected ?? [];
      const next = checked
        ? [...existing.filter((entry) => keyOf(entry.schema, entry.name, entry.kind) !== keyOf(item.schema, item.name, item.kind)), {
            schema: item.schema,
            name: item.name,
            kind: item.kind,
          }]
        : existing.filter((entry) => keyOf(entry.schema, entry.name, entry.kind) !== keyOf(item.schema, item.name, item.kind));
      return { ...current, selected: next };
    });
  }

  function selectVisible(checked: boolean) {
    setOptions((current) => {
      const existing = current.selected ?? [];
      const visibleKeys = new Set(visible.map((item) => keyOf(item.schema, item.name, item.kind)));
      const kept = existing.filter((item) => !visibleKeys.has(keyOf(item.schema, item.name, item.kind)));
      const added = checked
        ? visible.map((item) => ({ schema: item.schema, name: item.name, kind: item.kind }))
        : [];
      return { ...current, selected: [...kept, ...added] };
    });
  }

  async function submit() {
    const hasDatabase = databaseMode && options.includeDatabase;
    const hasSchemas = supportsSchemas && options.includeSchemas;
    if (!options.includeCreate && !options.includeData && !hasDatabase && !hasSchemas) {
      setError("Choose at least one script option.");
      return;
    }
    if (
      databaseMode &&
      (options.selected?.length ?? 0) === 0 &&
      !hasDatabase &&
      !hasSchemas
    ) {
      setError("Select at least one object.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onGenerate({
        ...options,
        includeDatabase: databaseMode && options.includeDatabase,
        includeSchemas: supportsSchemas && options.includeSchemas,
        selected: databaseMode ? options.selected : object
          ? [{ schema: object.schema, name: object.name, kind: object.kind }]
          : null,
      });
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  const title = object
    ? `Generate Script · ${object.schema ? `${object.schema}.` : ""}${object.name}`
    : `Generate Script · ${database}`;

  return (
    <div className="overlay front" onMouseDown={onCancel}>
      <div className="dialog script-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body script-body">
          <p className="script-lead">
            Choose what to put in the script. Structure creates objects; data adds INSERT statements.
            {databaseMode ? " Database and schemas can be scripted first." : supportsSchemas ? " Schemas can be scripted before tables and routines." : ""}
          </p>
          <div className="script-options">
            {databaseMode ? (
              <label>
                <input
                  type="checkbox"
                  checked={options.includeDatabase}
                  disabled={busy}
                  onChange={(event) => patch({ includeDatabase: event.target.checked })}
                />
                Database (CREATE DATABASE)
              </label>
            ) : null}
            <label>
              <input
                type="checkbox"
                checked={options.includeCreate}
                disabled={busy}
                onChange={(event) => patch({ includeCreate: event.target.checked })}
              />
              Structure (CREATE)
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.includeData}
                disabled={busy || (object != null && object.kind !== "table")}
                onChange={(event) => patch({ includeData: event.target.checked })}
              />
              Data (INSERT)
            </label>
            {supportsSchemas ? (
              <label>
                <input
                  type="checkbox"
                  checked={options.includeSchemas}
                  disabled={busy || !options.includeCreate}
                  onChange={(event) => patch({ includeSchemas: event.target.checked })}
                />
                Schemas (CREATE SCHEMA)
              </label>
            ) : null}
          </div>
          {databaseMode ? (
            <>
              <div className="script-options kinds">
                <label>
                  <input
                    type="checkbox"
                    checked={options.includeTables}
                    disabled={busy}
                    onChange={(event) => patch({ includeTables: event.target.checked })}
                  />
                  Tables
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.includeViews}
                    disabled={busy}
                    onChange={(event) => patch({ includeViews: event.target.checked })}
                  />
                  Views
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.includeProcedures}
                    disabled={busy}
                    onChange={(event) => patch({ includeProcedures: event.target.checked })}
                  />
                  Procedures
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={options.includeFunctions}
                    disabled={busy}
                    onChange={(event) => patch({ includeFunctions: event.target.checked })}
                  />
                  Functions
                </label>
              </div>
              <div className="script-picker">
                <div className="script-picker-bar">
                  <input
                    value={filter}
                    disabled={busy || loading}
                    placeholder="Filter objects"
                    onChange={(event) => setFilter(event.target.value)}
                  />
                  <button type="button" disabled={busy || loading} onClick={() => selectVisible(true)}>
                    Select visible
                  </button>
                  <button type="button" disabled={busy || loading} onClick={() => selectVisible(false)}>
                    Clear visible
                  </button>
                </div>
                <div className="script-object-list">
                  {loading ? <div className="empty-results">Loading objects...</div> : null}
                  {!loading && visible.length === 0 ? <div className="empty-results">No objects match.</div> : null}
                  {visible.map((item) => {
                    const key = keyOf(item.schema, item.name, item.kind);
                    return (
                      <label key={key} className="script-object-row">
                        <input
                          type="checkbox"
                          checked={selectedKeys.has(key)}
                          disabled={busy}
                          onChange={(event) => toggleObject(item, event.target.checked)}
                        />
                        <span className="kind">{item.kind}</span>
                        <span>
                          {item.schema ? `${item.schema}.` : ""}
                          {item.name}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </>
          ) : null}
        </div>
        {error ? <div className="dialog-error">{error}</div> : null}
        <div className="dialog-actions">
          <span className="script-count">
            {databaseMode
              ? `${options.selected?.length ?? 0} selected`
              : options.includeData
                ? "Structure and/or data"
                : "Structure"}
          </span>
          <span className="spacer" />
          <button type="button" className="default" disabled={busy || loading} onClick={() => void submit()}>
            {busy ? "Generating..." : "Generate"}
          </button>
          <button type="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function keyOf(schema: string, name: string, kind: string) {
  return `${kind}:${schema}.${name}`.toLowerCase();
}
