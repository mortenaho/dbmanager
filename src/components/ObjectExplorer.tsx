import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { listColumns, listObjects } from "../api";
import {
  errorText,
  objectTabTitle,
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
  onSelectTop: (connectionId: string, database: string, sql: string, title?: string) => void;
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
  onShowDetails: (target: {
    connection: Connection;
    database: string;
    folder: "table" | "view" | "procedure" | "function";
    title: string;
    objects: DbObject[];
  }) => void;
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
  onShowDetails,
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
  const objectsRef = useRef(objects);
  const shownFolder = useRef<{
    connectionId: string;
    database: string;
    folder: "table" | "view" | "procedure" | "function";
    title: string;
  } | null>(null);
  const showDetailsRef = useRef(onShowDetails);
  showDetailsRef.current = onShowDetails;
  connectionsRef.current = connections;
  expandedRef.current = expanded;
  objectsRef.current = objects;

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
  const rows = useMemo(
    () =>
      buildTree({
        connections,
        needle,
        expanded,
        objects,
        columns,
        loading,
        errors,
      }),
    [columns, connections, errors, expanded, loading, needle, objects],
  );
  const treeRef = useRef<HTMLDivElement>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [viewport, setViewport] = useState(480);

  useEffect(() => {
    const node = treeRef.current;
    if (!node) return;
    const measure = () => setViewport(node.clientHeight || 480);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [connections.length]);

  const start = Math.min(startIndex, Math.max(0, rows.length - 1));
  const visibleCount = Math.ceil(viewport / TREE_ROW) + TREE_OVERSCAN * 2;
  const visible = rows.slice(start, start + visibleCount);

  function publishDetails(
    connection: Connection,
    database: string,
    folder: "table" | "view" | "procedure" | "function",
    title: string,
    source: Record<string, DbObject[]>,
  ) {
    shownFolder.current = { connectionId: connection.id, database, folder, title };
    showDetailsRef.current({
      connection,
      database,
      folder,
      title,
      objects: (source[`${connection.id}:${database}`] ?? []).filter((object) => object.kind === folder),
    });
  }

  useEffect(() => {
    const current = shownFolder.current;
    if (!current) return;
    const connection = connections.find((item) => item.id === current.connectionId);
    if (!connection) return;
    showDetailsRef.current({
      connection,
      database: current.database,
      folder: current.folder,
      title: current.title,
      objects: (objects[`${current.connectionId}:${current.database}`] ?? []).filter((object) => object.kind === current.folder),
    });
  }, [connections, objects]);

  function onRowClick(item: TreeItem) {
    setSelected(item.id);
    if (!item.canExpand) {
      if (item.kind.type === "object") onSelectContext(item.kind.connection.id, item.kind.database);
      return;
    }
    const opening = !item.open;
    toggle(item.id);
    if (item.kind.type === "server") {
      onSelectContext(item.kind.connection.id, item.kind.connection.database);
    } else if (item.kind.type === "database") {
      onSelectContext(item.kind.connection.id, item.kind.database);
      if (opening) void loadObjects(item.kind.connection, item.kind.database);
    } else if (item.kind.type === "folder") {
      const { connection, database, folder, title } = item.kind;
      onSelectContext(connection.id, database);
      publishDetails(connection, database, folder, title, objects);
      if (!objects[`${connection.id}:${database}`]) void loadObjects(connection, database);
    } else if (item.kind.type === "object" && opening) {
      void loadColumns(item.kind.connection, item.kind.database, item.kind.object);
    }
  }

  function onRowDoubleClick(item: TreeItem) {
    if (item.kind.type === "database") {
      onNewQuery(item.kind.connection.id, item.kind.database);
    } else if (item.kind.type === "object") {
      const { connection, database, object, folder } = item.kind;
      if (folder === "procedure" || folder === "function") onScriptRoutine(connection.id, database, object);
      else {
        onSelectTop(
          connection.id,
          database,
          selectTopSql(connection.engine, object.schema, object.name),
          objectTabTitle(connection.engine, object.schema, object.name),
        );
      }
    }
  }

  function onRowMenu(event: MouseEvent, item: TreeItem) {
    if (item.kind.type === "server") {
      const connection = item.kind.connection;
      openMenu(event, [
        { label: "New Query", action: () => onNewQuery(connection.id, connection.database) },
        { label: "Refresh", action: () => refreshConnection(connection.id) },
        { label: "Disconnect", action: () => onDisconnect(connection.id) },
      ]);
    } else if (item.kind.type === "database") {
      const { connection, database } = item.kind;
      openMenu(event, [
        { label: "New Query", action: () => onNewQuery(connection.id, database) },
        { label: "Generate Scripts", action: () => onGenerateScript(connection.id, database, null, "schema") },
        { label: "Backup Database", action: () => onGenerateScript(connection.id, database, null, "backup") },
        { label: "Rename", action: () => onRenameDatabase(connection.id, database) },
        { label: "Refresh", action: () => refreshConnection(connection.id) },
      ]);
    } else if (item.kind.type === "object") {
      const { connection, database, object, folder } = item.kind;
      const routine = folder === "procedure" || folder === "function";
      const topLabel = connection.engine === "mssql" ? "Select Top 1000 Rows" : "Select First 1000 Rows";
      openMenu(
        event,
        routine
          ? [
              { label: "Script as CREATE", action: () => onScriptRoutine(connection.id, database, object) },
              { label: "New Query", action: () => onNewQuery(connection.id, database) },
            ]
          : folder === "view"
            ? [
                {
                  label: topLabel,
                  action: () =>
                    onSelectTop(
                      connection.id,
                      database,
                      selectTopSql(connection.engine, object.schema, object.name),
                      objectTabTitle(connection.engine, object.schema, object.name),
                    ),
                },
                { label: "Script as CREATE", action: () => onGenerateScript(connection.id, database, object, "create") },
                { label: "Rename", action: () => onRenameTable(connection.id, database, object.schema, object.name) },
                { label: "New Query", action: () => onNewQuery(connection.id, database) },
              ]
            : [
                {
                  label: topLabel,
                  action: () =>
                    onSelectTop(
                      connection.id,
                      database,
                      selectTopSql(connection.engine, object.schema, object.name),
                      objectTabTitle(connection.engine, object.schema, object.name),
                    ),
                },
                { label: "Script as CREATE", action: () => onGenerateScript(connection.id, database, object, "create") },
                { label: "Script as INSERT", action: () => onGenerateScript(connection.id, database, object, "insert") },
                {
                  label: "Script as CREATE and INSERT",
                  action: () => onGenerateScript(connection.id, database, object, "both"),
                },
                { label: "Rename", action: () => onRenameTable(connection.id, database, object.schema, object.name) },
                { label: "New Query", action: () => onNewQuery(connection.id, database) },
              ],
      );
    }
  }

  function refreshConnection(connectionId: string) {
    setObjects((current) => {
      const next = { ...current };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${connectionId}:`)) delete next[key];
      });
      return next;
    });
    setColumns((current) => {
      const next = { ...current };
      Object.keys(next).forEach((key) => {
        if (key.startsWith(`${connectionId}:`)) delete next[key];
      });
      return next;
    });
    onRefresh(connectionId);
  }

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
      <div
        className="tree"
        ref={treeRef}
        onScroll={(event) => {
          const next = Math.max(0, Math.floor(event.currentTarget.scrollTop / TREE_ROW) - TREE_OVERSCAN);
          setStartIndex((current) => (current === next ? current : next));
        }}
      >
        {connections.length === 0 ? (
          <div className="tree-muted">No servers connected. Click Connect.</div>
        ) : (
          <div className="tree-canvas" style={{ height: rows.length * TREE_ROW }}>
            <div className="tree-window" style={{ top: start * TREE_ROW }}>
              {visible.map((item) => (
                <TreeRow
                  key={item.id}
                  item={item}
                  selected={selected === item.id}
                  onClick={() => onRowClick(item)}
                  onDoubleClick={
                    item.kind.type === "database" || item.kind.type === "object" ? () => onRowDoubleClick(item) : undefined
                  }
                  onContextMenu={
                    item.kind.type === "server" || item.kind.type === "database" || item.kind.type === "object"
                      ? (event) => onRowMenu(event, item)
                      : undefined
                  }
                />
              ))}
            </div>
          </div>
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

const TREE_ROW = 22;
const TREE_OVERSCAN = 10;

type IconName = "server" | "database" | "folder" | "table" | "view" | "procedure" | "function" | "column" | "none";

const ICONS: Record<IconName, ReactNode> = {
  server: <ServerIcon />,
  database: <DatabaseIcon />,
  folder: <FolderIcon />,
  table: <TableIcon />,
  view: <ViewIcon />,
  procedure: <ProcedureIcon />,
  function: <FunctionIcon />,
  column: <ColumnIcon />,
  none: null,
};

type NodeKind =
  | { type: "server"; connection: Connection }
  | { type: "database"; connection: Connection; database: string }
  | {
      type: "folder";
      connection: Connection;
      database: string;
      folder: ObjectFolder;
      title: string;
    }
  | { type: "object"; connection: Connection; database: string; object: DbObject; folder: ObjectFolder }
  | { type: "column" }
  | { type: "status" };

type ObjectFolder = "table" | "view" | "procedure" | "function";

type TreeItem = {
  id: string;
  depth: number;
  label: string;
  icon: IconName;
  canExpand: boolean;
  open: boolean;
  tone?: "status" | "error";
  kind: NodeKind;
};

function buildTree(input: {
  connections: Connection[];
  needle: string;
  expanded: Set<string>;
  objects: Record<string, DbObject[]>;
  columns: Record<string, ColumnInfo[]>;
  loading: Set<string>;
  errors: Record<string, string>;
}): TreeItem[] {
  const rows: TreeItem[] = [];
  for (const connection of input.connections) {
    const serverId = `server:${connection.id}`;
    const serverOpen = input.expanded.has(serverId);
    rows.push({
      id: serverId,
      depth: 0,
      label: `${connection.name} (${engineLabel(connection.engine)})`,
      icon: "server",
      canExpand: true,
      open: serverOpen,
      kind: { type: "server", connection },
    });
    if (!serverOpen) continue;
    const databases = connection.databases.filter(
      (name) =>
        !input.needle ||
        name.toLowerCase().includes(input.needle) ||
        connection.name.toLowerCase().includes(input.needle),
    );
    for (const database of databases) {
      const dbId = `db:${connection.id}:${database}`;
      const key = `${connection.id}:${database}`;
      const dbOpen = input.expanded.has(dbId);
      rows.push({
        id: dbId,
        depth: 1,
        label: database,
        icon: "database",
        canExpand: true,
        open: dbOpen,
        kind: { type: "database", connection, database },
      });
      if (!dbOpen) continue;
      if (input.errors[key]) {
        rows.push(statusRow(`error:${key}`, 2, input.errors[key], "error"));
      }
      if (input.loading.has(key)) {
        rows.push(statusRow(`loading:${key}`, 2, "Loading...", "status"));
      }
      const items = input.objects[key] ?? [];
      pushFolder(rows, input, connection, database, key, "Tables", "tables", "table", items);
      pushFolder(rows, input, connection, database, key, "Views", "views", "view", items);
      pushFolder(rows, input, connection, database, key, "Stored Procedures", "procedures", "procedure", items);
      pushFolder(rows, input, connection, database, key, "Functions", "functions", "function", items);
    }
  }
  return rows;
}

function pushFolder(
  rows: TreeItem[],
  input: {
    expanded: Set<string>;
    columns: Record<string, ColumnInfo[]>;
    loading: Set<string>;
    errors: Record<string, string>;
  },
  connection: Connection,
  database: string,
  key: string,
  title: string,
  folderId: string,
  folder: ObjectFolder,
  items: DbObject[],
) {
  const id = `${folderId}:${key}`;
  const open = input.expanded.has(id);
  rows.push({
    id,
    depth: 2,
    label: title,
    icon: "folder",
    canExpand: true,
    open,
    kind: { type: "folder", connection, database, folder, title },
  });
  if (!open) return;
  for (const object of items) {
    if (object.kind !== folder) continue;
    const objectId = `obj:${connection.id}:${database}:${object.schema}.${object.name}`;
    const columnKey = `${connection.id}:${database}:${object.schema}.${object.name}`;
    const routine = folder === "procedure" || folder === "function";
    const objectOpen = !routine && input.expanded.has(objectId);
    const qualified = connection.engine === "mysql" ? object.name : `${object.schema}.${object.name}`;
    rows.push({
      id: objectId,
      depth: 3,
      label: qualified,
      icon: folder,
      canExpand: !routine,
      open: objectOpen,
      kind: { type: "object", connection, database, object, folder },
    });
    if (!objectOpen) continue;
    if (input.loading.has(columnKey)) rows.push(statusRow(`loading:${columnKey}`, 4, "Loading...", "status"));
    if (input.errors[columnKey]) rows.push(statusRow(`error:${columnKey}`, 4, input.errors[columnKey], "error"));
    for (const column of input.columns[columnKey] ?? []) {
      rows.push({
        id: `${objectId}:${column.name}`,
        depth: 4,
        label: `${column.primaryKey ? "PK " : ""}${column.name} (${column.dataType}, ${column.nullable ? "null" : "not null"})`,
        icon: "column",
        canExpand: false,
        open: false,
        kind: { type: "column" },
      });
    }
  }
}

function statusRow(id: string, depth: number, label: string, tone: "status" | "error"): TreeItem {
  return { id, depth, label, icon: "none", canExpand: false, open: false, tone, kind: { type: "status" } };
}

function TreeRow(props: {
  item: TreeItem;
  selected: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (event: MouseEvent) => void;
}) {
  const lastClick = useRef(0);
  const item = props.item;
  return (
    <div
      className={`tree-row${item.open ? " open" : ""}${props.selected ? " selected" : ""}${item.tone ? ` ${item.tone}` : ""}`}
      style={{ paddingLeft: 6 + item.depth * 16 }}
      title={item.label}
      onClick={() => {
        const now = performance.now();
        if (props.onDoubleClick && now - lastClick.current < 280) {
          lastClick.current = 0;
          return;
        }
        lastClick.current = now;
        props.onClick();
      }}
      onDoubleClick={props.onDoubleClick}
      onContextMenu={props.onContextMenu}
    >
      <span className="twist">{item.canExpand ? <i /> : null}</span>
      {ICONS[item.icon]}
      <span className="tree-label">{item.label}</span>
    </div>
  );
}

function engineLabel(engine: EngineKind): string {
  if (engine === "mssql") return "SQL Server";
  if (engine === "postgres") return "PostgreSQL";
  return "MySQL";
}
