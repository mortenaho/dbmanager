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

export type ScriptPreset = "schema" | "backup" | "custom" | "create" | "insert" | "both";

type Props = {
  connectionId: string;
  database: string;
  engine: EngineKind;
  object: DbObject | null;
  preset: ScriptPreset;
  onCancel: () => void;
  onGenerate: (options: ScriptGenerateOptions) => Promise<void>;
};

type SelectedRef = { schema: string; name: string; kind: string };

function defaults(preset: ScriptPreset, object: DbObject | null): ScriptGenerateOptions {
  const backup = preset === "backup";
  const fromObject = object != null;
  return {
    includeCreate: preset !== "insert",
    includeData: backup || preset === "insert" || preset === "both",
    // Always offer recreate-on-empty-server statements by default.
    includeDatabase: true,
    includeSchemas: true,
    includeTables: !fromObject || object?.kind === "table",
    includeViews: !fromObject || object?.kind === "view",
    includeProcedures: !fromObject || object?.kind === "procedure",
    includeFunctions: !fromObject || object?.kind === "function",
    selected: fromObject
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
  const [schemaFilter, setSchemaFilter] = useState<Set<string> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const supportsSchemas = engine !== "mysql";

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    listObjects(connectionId, database)
      .then((items) => {
        if (cancel) return;
        setObjects(items);
        setOptions((current) => {
          if (object) {
            return {
              ...current,
              selected: [{ schema: object.schema, name: object.name, kind: object.kind }],
            };
          }
          return {
            ...current,
            selected: items.map((item) => ({
              schema: item.schema,
              name: item.name,
              kind: item.kind,
            })),
          };
        });
        if (supportsSchemas) {
          const schemas = uniqueSchemas(items);
          setSchemaFilter(new Set(schemas));
        } else {
          setSchemaFilter(null);
        }
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
  }, [connectionId, database, object, supportsSchemas]);

  const schemas = useMemo(() => uniqueSchemas(objects), [objects]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return objects.filter((item) => {
      if (supportsSchemas && schemaFilter && !schemaFilter.has(schemaKey(item.schema))) return false;
      if (item.kind === "table" && !options.includeTables) return false;
      if (item.kind === "view" && !options.includeViews) return false;
      if (item.kind === "procedure" && !options.includeProcedures) return false;
      if (item.kind === "function" && !options.includeFunctions) return false;
      if (!needle) return true;
      return `${item.schema}.${item.name} ${item.kind}`.toLowerCase().includes(needle);
    });
  }, [objects, options, filter, schemaFilter, supportsSchemas]);

  const grouped = useMemo(() => {
    const map = new Map<string, DbObject[]>();
    for (const item of visible) {
      const key = schemaKey(item.schema) || "(default)";
      const list = map.get(key) ?? [];
      list.push(item);
      map.set(key, list);
    }
    return [...map.entries()];
  }, [visible]);

  const selectedKeys = useMemo(() => {
    return new Set((options.selected ?? []).map((item) => keyOf(item.schema, item.name, item.kind)));
  }, [options.selected]);

  function patch(partial: Partial<ScriptGenerateOptions>) {
    setOptions((current) => ({ ...current, ...partial }));
  }

  function toggleObject(item: DbObject, checked: boolean) {
    setOptions((current) => {
      const existing = current.selected ?? [];
      const id = keyOf(item.schema, item.name, item.kind);
      const next = checked
        ? [
            ...existing.filter((entry) => keyOf(entry.schema, entry.name, entry.kind) !== id),
            { schema: item.schema, name: item.name, kind: item.kind },
          ]
        : existing.filter((entry) => keyOf(entry.schema, entry.name, entry.kind) !== id);
      return { ...current, selected: next };
    });
  }

  function selectItems(items: DbObject[], checked: boolean) {
    setOptions((current) => {
      const existing = current.selected ?? [];
      const touch = new Set(items.map((item) => keyOf(item.schema, item.name, item.kind)));
      const kept = existing.filter((item) => !touch.has(keyOf(item.schema, item.name, item.kind)));
      const added = checked
        ? items.map((item) => ({ schema: item.schema, name: item.name, kind: item.kind }))
        : [];
      return { ...current, selected: [...kept, ...added] };
    });
  }

  function toggleSchemaVisible(schema: string, checked: boolean) {
    const items = visible.filter((item) => schemaKey(item.schema) === schemaKey(schema));
    selectItems(items, checked);
  }

  function toggleSchemaFilter(schema: string, checked: boolean) {
    setSchemaFilter((current) => {
      const next = new Set(current ?? schemas);
      if (checked) next.add(schemaKey(schema));
      else next.delete(schemaKey(schema));
      return next;
    });
    const items = objects.filter((item) => schemaKey(item.schema) === schemaKey(schema));
    selectItems(items, checked);
  }

  function selectAllSchemas(checked: boolean) {
    setSchemaFilter(checked ? new Set(schemas) : new Set());
    if (!checked) patch({ selected: [] });
    else selectItems(objects, true);
  }

  async function submit() {
    const hasDatabase = options.includeDatabase;
    const hasSchemas = supportsSchemas && options.includeSchemas;
    const selected = filterSelected(options.selected ?? [], objects, options, schemaFilter, supportsSchemas);
    if (!options.includeCreate && !options.includeData && !hasDatabase && !hasSchemas) {
      setError("Choose at least one script option.");
      return;
    }
    if (selected.length === 0 && !hasDatabase && !hasSchemas) {
      setError("Select at least one object or schema option.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onGenerate({
        ...options,
        includeDatabase: options.includeDatabase,
        includeSchemas: supportsSchemas && options.includeSchemas,
        selected,
      });
    } catch (reason) {
      setError(errorText(reason));
      setBusy(false);
    }
  }

  const title = object
    ? `Generate Script · ${object.schema ? `${object.schema}.` : ""}${object.name}`
    : `Generate Script · ${database}`;

  const selectedCount = options.selected?.length ?? 0;

  return (
    <div className="overlay front" onMouseDown={onCancel}>
      <div className="dialog script-dialog" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">{title}</div>
        <div className="dialog-body script-body">
          <p className="script-lead">
            Choose schemas and objects for the script. Structure writes CREATE statements; data adds INSERT rows.
          </p>
          <div className="script-options">
            <label>
              <input
                type="checkbox"
                checked={options.includeDatabase}
                disabled={busy}
                onChange={(event) => patch({ includeDatabase: event.target.checked })}
              />
                Database (CREATE IF NOT EXISTS)
            </label>
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
                disabled={busy}
                onChange={(event) => patch({ includeData: event.target.checked })}
              />
              Data (INSERT)
            </label>
            {supportsSchemas ? (
              <label>
                <input
                  type="checkbox"
                  checked={options.includeSchemas}
                  disabled={busy}
                  onChange={(event) => patch({ includeSchemas: event.target.checked })}
                />
                Schemas (CREATE SCHEMA IF NOT EXISTS)
              </label>
            ) : null}
          </div>
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
          <div className="script-pickers">
            {supportsSchemas ? (
              <div className="script-picker script-schema-picker">
                <div className="script-picker-bar">
                  <strong>Schemas</strong>
                  <span className="spacer" />
                  <button type="button" disabled={busy || loading} onClick={() => selectAllSchemas(true)}>
                    All
                  </button>
                  <button type="button" disabled={busy || loading} onClick={() => selectAllSchemas(false)}>
                    None
                  </button>
                </div>
                <div className="script-object-list compact">
                  {loading ? <div className="empty-results">Loading...</div> : null}
                  {!loading && schemas.length === 0 ? <div className="empty-results">No schemas.</div> : null}
                  {schemas.map((schema) => {
                    const active = schemaFilter?.has(schemaKey(schema)) ?? true;
                    const inSchema = objects.filter((item) => schemaKey(item.schema) === schemaKey(schema));
                    const selectedInSchema = inSchema.filter((item) =>
                      selectedKeys.has(keyOf(item.schema, item.name, item.kind)),
                    ).length;
                    return (
                      <label key={schema || "(default)"} className="script-object-row">
                        <input
                          type="checkbox"
                          checked={active}
                          disabled={busy}
                          onChange={(event) => toggleSchemaFilter(schema, event.target.checked)}
                        />
                        <span>{schema || "(default)"}</span>
                        <span className="script-meta">
                          {selectedInSchema}/{inSchema.length}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <div className="script-picker">
              <div className="script-picker-bar">
                <input
                  value={filter}
                  disabled={busy || loading}
                  placeholder="Filter objects"
                  onChange={(event) => setFilter(event.target.value)}
                />
                <button type="button" disabled={busy || loading} onClick={() => selectItems(visible, true)}>
                  Select visible
                </button>
                <button type="button" disabled={busy || loading} onClick={() => selectItems(visible, false)}>
                  Clear visible
                </button>
              </div>
              <div className="script-object-list">
                {loading ? <div className="empty-results">Loading objects...</div> : null}
                {!loading && visible.length === 0 ? <div className="empty-results">No objects match.</div> : null}
                {grouped.map(([schema, items]) => {
                  const allSelected = items.every((item) => selectedKeys.has(keyOf(item.schema, item.name, item.kind)));
                  const someSelected = items.some((item) => selectedKeys.has(keyOf(item.schema, item.name, item.kind)));
                  return (
                    <div key={schema} className="script-group">
                      <label className="script-object-row script-group-head">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(node) => {
                            if (node) node.indeterminate = !allSelected && someSelected;
                          }}
                          disabled={busy}
                          onChange={(event) => toggleSchemaVisible(schema, event.target.checked)}
                        />
                        <span className="kind">schema</span>
                        <span>{schema}</span>
                        <span className="script-meta">{items.length}</span>
                      </label>
                      {items.map((item) => {
                        const key = keyOf(item.schema, item.name, item.kind);
                        return (
                          <label key={key} className="script-object-row nested">
                            <input
                              type="checkbox"
                              checked={selectedKeys.has(key)}
                              disabled={busy}
                              onChange={(event) => toggleObject(item, event.target.checked)}
                            />
                            <span className="kind">{item.kind}</span>
                            <span>{item.name}</span>
                          </label>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
        {error ? <div className="dialog-error">{error}</div> : null}
        <div className="dialog-actions">
          <span className="script-count">{selectedCount} object(s) selected</span>
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

function schemaKey(schema: string) {
  return schema.trim().toLowerCase();
}

function uniqueSchemas(objects: DbObject[]) {
  const values = [...new Set(objects.map((item) => item.schema))];
  values.sort((left, right) => left.localeCompare(right));
  return values;
}

function filterSelected(
  selected: SelectedRef[],
  objects: DbObject[],
  options: ScriptGenerateOptions,
  schemaFilter: Set<string> | null,
  supportsSchemas: boolean,
): SelectedRef[] {
  const allowed = new Set(
    objects
      .filter((item) => {
        if (supportsSchemas && schemaFilter && !schemaFilter.has(schemaKey(item.schema))) return false;
        if (item.kind === "table" && !options.includeTables) return false;
        if (item.kind === "view" && !options.includeViews) return false;
        if (item.kind === "procedure" && !options.includeProcedures) return false;
        if (item.kind === "function" && !options.includeFunctions) return false;
        return true;
      })
      .map((item) => keyOf(item.schema, item.name, item.kind)),
  );
  return selected.filter((item) => allowed.has(keyOf(item.schema, item.name, item.kind)));
}
