import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { listColumns, listObjects } from "../api";
import {
  errorText,
  selectTopSql,
  type ColumnInfo,
  type Connection,
  type DbObject,
  type EngineKind,
} from "../types";
import {
  ColumnIcon,
  DatabaseIcon,
  FolderIcon,
  FunctionIcon,
  PlugIcon,
  ProcedureIcon,
  RefreshIcon,
  ServerIcon,
  TableIcon,
  ViewIcon,
} from "./Icons";

type Props = {
  width: number;
  connections: Connection[];
  filter: string;
  reloadKey: number;
  onFilter: (value: string) => void;
  onConnect: () => void;
  onDisconnect: (connectionId: string) => void;
  onRefresh: (connectionId: string) => void;
  onNewQuery: (connectionId: string, database: string) => void;
  onSelectTop: (connectionId: string, database: string, sql: string) => void;
  onSelectContext: (connectionId: string, database: string) => void;
  onRenameDatabase: (connectionId: string, database: string) => void;
  onRenameTable: (connectionId: string, database: string, schema: string, name: string) => void;
  onScriptRoutine: (connectionId: string, database: string, object: DbObject) => void;
  onGenerateScript: (
    connectionId: string,
    database: string,
    object: DbObject | null,
    mode: "create" | "insert" | "both" | "schema" | "backup",
  ) => void;
};

type MenuState = {
  x: number;
  y: number;
  items: Array<{ label: string; action: () => void }>;
};

export function ObjectExplorer({
  width,
  connections,
  filter,
  reloadKey,
  onFilter,
  onConnect,
  onDisconnect,
  onRefresh,
  onNewQuery,
  onSelectTop,
  onSelectContext,
  onRenameDatabase,
  onRenameTable,
  onScriptRoutine,
  onGenerateScript,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState("");
  const [objects, setObjects] = useState<Record<string, DbObject[]>>({});
  const [columns, setColumns] = useState<Record<string, ColumnInfo[]>>({});
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [menu, setMenu] = useState<MenuState | null>(null);
  const connectionsRef = useRef(connections);
  const expandedRef = useRef(expanded);
  connectionsRef.current = connections;
  expandedRef.current = expanded;

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function loadObjects(connection: Connection, database: string, force = false) {
    const key = `${connection.id}:${database}`;
    if (!force && (objects[key] || loading.has(key))) return;
    setLoading((current) => new Set(current).add(key));
    try {
      const rows = await listObjects(connection.id, database);
      setObjects((current) => ({ ...current, [key]: rows }));
      setErrors((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
    } catch (reason) {
      setErrors((current) => ({ ...current, [key]: errorText(reason) }));
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  useEffect(() => {
    if (reloadKey === 0) return;
    setObjects({});
    setColumns({});
    for (const connection of connectionsRef.current) {
      for (const database of connection.databases) {
        if (expandedRef.current.has(`db:${connection.id}:${database}`)) {
          void loadObjects(connection, database, true);
        }
      }
    }
  }, [reloadKey]);

  async function loadColumns(connection: Connection, database: string, object: DbObject) {
    const key = `${connection.id}:${database}:${object.schema}.${object.name}`;
    if (columns[key] || loading.has(key)) return;
    setLoading((current) => new Set(current).add(key));
    try {
      const rows = await listColumns(connection.id, database, object.schema, object.name);
      setColumns((current) => ({ ...current, [key]: rows }));
    } catch (reason) {
      setErrors((current) => ({ ...current, [key]: errorText(reason) }));
    } finally {
      setLoading((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }

  function openMenu(event: MouseEvent, items: MenuState["items"]) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }

  const needle = filter.trim().toLowerCase();

  return (
    <aside className="explorer" style={{ width }}>
      <div className="explorer-caption">
        <span>Object Explorer</span>
        <div className="explorer-tools">
          <button title="Connect" onClick={onConnect}>
            <PlugIcon />
          </button>
          <button
            title="Refresh"
            onClick={() => {
              setObjects({});
              setColumns({});
              connections.forEach((connection) => onRefresh(connection.id));
            }}
          >
            <RefreshIcon />
          </button>
        </div>
      </div>
      <input
        className="explorer-filter"
        placeholder="Filter"
        value={filter}
        onChange={(event) => onFilter(event.target.value)}
      />
      <div className="tree">
        {connections.length === 0 ? (
          <div className="tree-muted">No servers connected. Click Connect.</div>
        ) : (
          connections.map((connection) => (
            <ServerNode
              key={connection.id}
              connection={connection}
              needle={needle}
              expanded={expanded}
              selected={selected}
              objects={objects}
              columns={columns}
              loading={loading}
              errors={errors}
              onToggle={(id) => {
                toggle(id);
                setSelected(id);
              }}
              onSelect={(id, database) => {
                setSelected(id);
                onSelectContext(connection.id, database);
              }}
              onExpandDatabase={(database) => {
                const folder = `tables:${connection.id}:${database}`;
                if (!expanded.has(folder)) void loadObjects(connection, database);
              }}
              onExpandObject={(database, object) => void loadColumns(connection, database, object)}
              onMenu={openMenu}
              onDisconnect={() => onDisconnect(connection.id)}
              onRefresh={() => {
                setObjects((current) => {
                  const next = { ...current };
                  Object.keys(next).forEach((key) => {
                    if (key.startsWith(`${connection.id}:`)) delete next[key];
                  });
                  return next;
                });
                onRefresh(connection.id);
              }}
              onNewQuery={(database) => onNewQuery(connection.id, database)}
              onSelectTop={(database, object) =>
                onSelectTop(
                  connection.id,
                  database,
                  selectTopSql(connection.engine, object.schema, object.name),
                )
              }
              onRenameDatabase={(database) => onRenameDatabase(connection.id, database)}
              onRenameTable={(database, object) =>
                onRenameTable(connection.id, database, object.schema, object.name)
              }
              onScriptRoutine={(database, object) => onScriptRoutine(connection.id, database, object)}
              onGenerateScript={(database, object, mode) =>
                onGenerateScript(connection.id, database, object, mode)
              }
            />
          ))
        )}
      </div>
      {menu ? (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          {menu.items.map((item) => (
            <button
              key={item.label}
              onClick={() => {
                setMenu(null);
                item.action();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}

function ServerNode(props: {
  connection: Connection;
  needle: string;
  expanded: Set<string>;
  selected: string;
  objects: Record<string, DbObject[]>;
  columns: Record<string, ColumnInfo[]>;
  loading: Set<string>;
  errors: Record<string, string>;
  onToggle: (id: string) => void;
  onSelect: (id: string, database: string) => void;
  onExpandDatabase: (database: string) => void;
  onExpandObject: (database: string, object: DbObject) => void;
  onMenu: (event: MouseEvent, items: MenuState["items"]) => void;
  onDisconnect: () => void;
  onRefresh: () => void;
  onNewQuery: (database: string) => void;
  onSelectTop: (database: string, object: DbObject) => void;
  onRenameDatabase: (database: string) => void;
  onRenameTable: (database: string, object: DbObject) => void;
  onScriptRoutine: (database: string, object: DbObject) => void;
  onGenerateScript: (
    database: string,
    object: DbObject | null,
    mode: "create" | "insert" | "both" | "schema" | "backup",
  ) => void;
}) {
  const id = `server:${props.connection.id}`;
  const open = props.expanded.has(id);
  const databases = props.connection.databases.filter((name) => !props.needle || name.toLowerCase().includes(props.needle) || props.connection.name.toLowerCase().includes(props.needle));
  return (
    <div>
      <Row
        depth={0}
        id={id}
        selected={props.selected}
        open={open}
        canExpand
        icon={<ServerIcon />}
        label={`${props.connection.name} (${label(props.connection.engine)})`}
        onClick={() => {
          props.onToggle(id);
          props.onSelect(id, props.connection.database);
        }}
        onContextMenu={(event) =>
          props.onMenu(event, [
            { label: "New Query", action: () => props.onNewQuery(props.connection.database) },
            { label: "Refresh", action: props.onRefresh },
            { label: "Disconnect", action: props.onDisconnect },
          ])
        }
      />
      {open
        ? databases.map((database) => (
            <DatabaseNode key={database} database={database} {...props} />
          ))
        : null}
    </div>
  );
}

function DatabaseNode(
  props: {
    database: string;
  } & Omit<Parameters<typeof ServerNode>[0], "needle">,
) {
  const id = `db:${props.connection.id}:${props.database}`;
  const open = props.expanded.has(id);
  const key = `${props.connection.id}:${props.database}`;
  const items = props.objects[key] ?? [];
  const tables = items.filter((item) => item.kind === "table");
  const views = items.filter((item) => item.kind === "view");
  const procedures = items.filter((item) => item.kind === "procedure");
  const functions = items.filter((item) => item.kind === "function");
  return (
    <div>
      <Row
        depth={1}
        id={id}
        selected={props.selected}
        open={open}
        canExpand
        icon={<DatabaseIcon />}
        label={props.database}
        onClick={() => {
          props.onToggle(id);
          props.onSelect(id, props.database);
          if (!open) props.onExpandDatabase(props.database);
        }}
        onDoubleClick={() => props.onNewQuery(props.database)}
        onContextMenu={(event) =>
          props.onMenu(event, [
            { label: "New Query", action: () => props.onNewQuery(props.database) },
            {
              label: "Generate Scripts",
              action: () => props.onGenerateScript(props.database, null, "schema"),
            },
            {
              label: "Backup Database",
              action: () => props.onGenerateScript(props.database, null, "backup"),
            },
            { label: "Rename", action: () => props.onRenameDatabase(props.database) },
            { label: "Refresh", action: props.onRefresh },
          ])
        }
      />
      {open ? (
        <>
          {props.errors[key] ? <div className="tree-error">{props.errors[key]}</div> : null}
          {props.loading.has(key) ? <div className="tree-muted">Loading...</div> : null}
          <Folder
            depth={2}
            id={`tables:${key}`}
            title="Tables"
            selected={props.selected}
            expanded={props.expanded}
            objects={tables}
            onToggle={props.onToggle}
            render={(object) => (
              <ObjectNode key={`${object.schema}.${object.name}`} object={object} folder="table" {...props} />
            )}
          />
          <Folder
            depth={2}
            id={`views:${key}`}
            title="Views"
            selected={props.selected}
            expanded={props.expanded}
            objects={views}
            onToggle={props.onToggle}
            render={(object) => (
              <ObjectNode key={`${object.schema}.${object.name}`} object={object} folder="view" {...props} />
            )}
          />
          <Folder
            depth={2}
            id={`procedures:${key}`}
            title="Stored Procedures"
            selected={props.selected}
            expanded={props.expanded}
            objects={procedures}
            onToggle={props.onToggle}
            render={(object) => (
              <ObjectNode key={`${object.schema}.${object.name}`} object={object} folder="procedure" {...props} />
            )}
          />
          <Folder
            depth={2}
            id={`functions:${key}`}
            title="Functions"
            selected={props.selected}
            expanded={props.expanded}
            objects={functions}
            onToggle={props.onToggle}
            render={(object) => (
              <ObjectNode key={`${object.schema}.${object.name}`} object={object} folder="function" {...props} />
            )}
          />
        </>
      ) : null}
    </div>
  );
}

function Folder(props: {
  depth: number;
  id: string;
  title: string;
  selected: string;
  expanded: Set<string>;
  objects: DbObject[];
  onToggle: (id: string) => void;
  render: (object: DbObject) => ReactNode;
}) {
  const open = props.expanded.has(props.id);
  return (
    <div>
      <Row
        depth={props.depth}
        id={props.id}
        selected={props.selected}
        open={open}
        canExpand
        icon={<FolderIcon />}
        label={props.title}
        onClick={() => props.onToggle(props.id)}
      />
      {open ? props.objects.map(props.render) : null}
    </div>
  );
}

function ObjectNode(
  props: {
    object: DbObject;
    folder: "table" | "view" | "procedure" | "function";
    database: string;
    connection: Connection;
    expanded: Set<string>;
    selected: string;
    columns: Record<string, ColumnInfo[]>;
    loading: Set<string>;
    errors: Record<string, string>;
    onToggle: (id: string) => void;
    onExpandObject: (database: string, object: DbObject) => void;
    onSelectTop: (database: string, object: DbObject) => void;
    onNewQuery: (database: string) => void;
    onRenameTable: (database: string, object: DbObject) => void;
    onScriptRoutine: (database: string, object: DbObject) => void;
    onGenerateScript: (
      database: string,
      object: DbObject | null,
      mode: "create" | "insert" | "both" | "schema" | "backup",
    ) => void;
    onMenu: (event: MouseEvent, items: MenuState["items"]) => void;
  },
) {
  const id = `obj:${props.connection.id}:${props.database}:${props.object.schema}.${props.object.name}`;
  const columnKey = `${props.connection.id}:${props.database}:${props.object.schema}.${props.object.name}`;
  const open = props.expanded.has(id);
  const cols = props.columns[columnKey] ?? [];
  const routine = props.folder === "procedure" || props.folder === "function";
  const qualified =
    props.connection.engine === "mysql" ? props.object.name : `${props.object.schema}.${props.object.name}`;
  return (
    <div>
      <Row
        depth={3}
        id={id}
        selected={props.selected}
        open={open}
        canExpand={!routine}
        icon={iconFor(props.folder)}
        label={qualified}
        onClick={() => {
          props.onToggle(id);
          if (routine) {
            if (!open) props.onToggle(id);
            return;
          }
          if (!open) props.onExpandObject(props.database, props.object);
        }}
        onDoubleClick={() =>
          routine ? props.onScriptRoutine(props.database, props.object) : props.onSelectTop(props.database, props.object)
        }
        onContextMenu={(event) =>
          props.onMenu(
            event,
            routine
              ? [
                  { label: "Script as CREATE", action: () => props.onScriptRoutine(props.database, props.object) },
                  { label: "New Query", action: () => props.onNewQuery(props.database) },
                ]
              : props.folder === "view"
                ? [
                    {
                      label: props.connection.engine === "mssql" ? "Select Top 1000 Rows" : "Select First 1000 Rows",
                      action: () => props.onSelectTop(props.database, props.object),
                    },
                    {
                      label: "Script as CREATE",
                      action: () => props.onGenerateScript(props.database, props.object, "create"),
                    },
                    { label: "Rename", action: () => props.onRenameTable(props.database, props.object) },
                    { label: "New Query", action: () => props.onNewQuery(props.database) },
                  ]
                : [
                    {
                      label: props.connection.engine === "mssql" ? "Select Top 1000 Rows" : "Select First 1000 Rows",
                      action: () => props.onSelectTop(props.database, props.object),
                    },
                    {
                      label: "Script as CREATE",
                      action: () => props.onGenerateScript(props.database, props.object, "create"),
                    },
                    {
                      label: "Script as INSERT",
                      action: () => props.onGenerateScript(props.database, props.object, "insert"),
                    },
                    {
                      label: "Script as CREATE and INSERT",
                      action: () => props.onGenerateScript(props.database, props.object, "both"),
                    },
                    { label: "Rename", action: () => props.onRenameTable(props.database, props.object) },
                    { label: "New Query", action: () => props.onNewQuery(props.database) },
                  ],
          )
        }
      />
      {open && props.loading.has(columnKey) ? <div className="tree-muted">Loading...</div> : null}
      {open && props.errors[columnKey] ? <div className="tree-error">{props.errors[columnKey]}</div> : null}
      {open
        ? cols.map((column) => (
            <Row
              key={column.name}
              depth={4}
              id={`${id}:${column.name}`}
              selected={props.selected}
              open={false}
              canExpand={false}
              icon={<ColumnIcon />}
              label={`${column.primaryKey ? "PK " : ""}${column.name} (${column.dataType}, ${column.nullable ? "null" : "not null"})`}
              onClick={() => props.onToggle(`${id}:${column.name}`)}
            />
          ))
        : null}
    </div>
  );
}

function Row(props: {
  depth: number;
  id: string;
  selected: string;
  open: boolean;
  canExpand: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  return (
    <div
      className={`tree-row ${props.selected === props.id ? "selected" : ""}`}
      style={{ paddingLeft: 6 + props.depth * 16 }}
      onClick={props.onClick}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      <span className="twist">{props.canExpand ? (props.open ? "▾" : "▸") : ""}</span>
      {props.icon}
      <span className="tree-label">{props.label}</span>
    </div>
  );
}

function iconFor(folder: "table" | "view" | "procedure" | "function") {
  if (folder === "view") return <ViewIcon />;
  if (folder === "procedure") return <ProcedureIcon />;
  if (folder === "function") return <FunctionIcon />;
  return <TableIcon />;
}

function label(engine: EngineKind): string {
  if (engine === "mssql") return "SQL Server";
  if (engine === "postgres") return "PostgreSQL";
  return "MySQL";
}
