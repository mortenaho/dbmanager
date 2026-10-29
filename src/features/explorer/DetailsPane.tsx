import { useMemo, useState, type MouseEvent } from "react";
import { engineLabel, type Connection, type DbObject } from "../../shared/types";
import { FunctionIcon, ProcedureIcon, TableIcon, ViewIcon } from "../../shared/icons/Icons";

type Folder = "table" | "view" | "procedure" | "function";
type ColumnId = "name" | "schema" | "created" | "rowCount";

const COLUMNS: Array<{ id: ColumnId; label: string; width: number; align?: "right" }> = [
  { id: "name", label: "Name", width: 240 },
  { id: "schema", label: "Schema", width: 120 },
  { id: "created", label: "Create Date", width: 150 },
  { id: "rowCount", label: "Row Count", width: 90, align: "right" },
];

export type DetailsTarget = {
  connection: Connection;
  database: string;
  folder: Folder;
  title: string;
  objects: DbObject[];
};

export function DetailsPane(props: {
  target: DetailsTarget;
  onOpen: (object: DbObject) => void;
}) {
  const countable = props.target.folder === "table" || props.target.folder === "view";
  const [visible, setVisible] = useState<ColumnId[]>(
    countable ? ["name", "schema", "created", "rowCount"] : ["name", "schema", "created"],
  );
  const [sortKey, setSortKey] = useState<ColumnId | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selected, setSelected] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number; column: ColumnId } | null>(null);

  const rows = useMemo(() => {
    const items = [...props.target.objects];
    items.sort((left, right) => {
      const delta = sortKey ? compareColumn(left, right, sortKey) : compareNatural(left, right);
      return sortDir === "asc" ? delta : -delta;
    });
    return items;
  }, [props.target.objects, sortDir, sortKey]);

  const shown = COLUMNS.filter((column) => visible.includes(column.id));

  function toggleSort(column: ColumnId, direction?: "asc" | "desc") {
    if (direction) {
      setSortKey(column);
      setSortDir(direction);
      return;
    }
    if (sortKey === column) setSortDir((current) => (current === "asc" ? "desc" : "asc"));
    else {
      setSortKey(column);
      setSortDir("asc");
    }
  }

  function toggleColumn(column: ColumnId) {
    setVisible((current) => {
      if (current.includes(column)) {
        if (current.length === 1) return current;
        return current.filter((item) => item !== column);
      }
      return COLUMNS.map((item) => item.id).filter((item) => item === column || current.includes(item));
    });
  }

  function openMenu(event: MouseEvent, column: ColumnId) {
    event.preventDefault();
    const width = 196;
    const height = 250;
    const x = Math.max(4, Math.min(event.clientX, window.innerWidth - width - 8));
    const y = Math.max(4, Math.min(event.clientY, window.innerHeight - height - 8));
    setMenu({ x, y, column });
  }

  const engine = props.target.connection.engine;
  const place = engine === "mssql" ? `Databases\\${props.target.database}` : props.target.database;
  const path = `${props.target.connection.name} (${engineLabel(engine)})\\${place}\\${props.target.title}`;

  return (
    <div className="details" onMouseDown={() => setMenu(null)}>
      <div className="details-path" title={path}>
        {path}
      </div>
      <div className="details-grid">
        <div className="details-head">
          {shown.map((column) => (
            <button
              key={column.id}
              className="details-cell head"
              style={columnStyle(column)}
              onClick={() => toggleSort(column.id)}
              onContextMenu={(event) => openMenu(event, column.id)}
            >
              <span>{column.label}</span>
              {sortKey === column.id ? <span className="details-sort">{sortDir === "asc" ? "▲" : "▼"}</span> : null}
            </button>
          ))}
        </div>
        {rows.map((object) => {
          const key = `${object.schema}.${object.name}`;
          return (
            <div
              key={key}
              className={`details-row ${selected === key ? "selected" : ""}`}
              onClick={() => setSelected(key)}
              onDoubleClick={() => props.onOpen(object)}
            >
              {shown.map((column) => (
                <div
                  key={column.id}
                  className="details-cell"
                  style={{ ...columnStyle(column), justifyContent: column.align === "right" ? "flex-end" : "flex-start" }}
                  title={cellText(object, column.id)}
                >
                  {column.id === "name" ? <RowIcon folder={props.target.folder} /> : null}
                  <span>{cellText(object, column.id)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div className="details-foot">
        <span>{props.target.title}</span>
        <span>
          {rows.length} {rows.length === 1 ? "Item" : "Items"}
        </span>
      </div>
      {menu ? (
        <div
          className="context-menu details-menu"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            onClick={() => {
              toggleSort(menu.column, "asc");
              setMenu(null);
            }}
          >
            Sort Ascending
          </button>
          <button
            onClick={() => {
              toggleSort(menu.column, "desc");
              setMenu(null);
            }}
          >
            Sort Descending
          </button>
          <div className="menu-sep" />
          {COLUMNS.map((column) => (
            <button key={column.id} onClick={() => toggleColumn(column.id)}>
              <span className="mark">{visible.includes(column.id) ? "✓" : ""}</span>
              <span>{column.label}</span>
            </button>
          ))}
          <div className="menu-sep" />
          <button
            onClick={() => {
              setVisible(countable ? ["name", "schema", "created", "rowCount"] : ["name", "schema", "created"]);
              setSortKey(null);
              setSortDir("asc");
              setMenu(null);
            }}
          >
            Reset View
          </button>
        </div>
      ) : null}
    </div>
  );
}

function columnStyle(column: { id: ColumnId; width: number; align?: "right" }): {
  width?: number;
  minWidth: number;
  flex: string;
  textAlign: "left" | "right";
} {
  if (column.id === "name") {
    return { minWidth: 140, flex: "1 1 auto", textAlign: "left" };
  }
  return { width: column.width, minWidth: column.width, flex: "none", textAlign: column.align ?? "left" };
}

function formatCreated(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(trimmed);
  if (!match) return trimmed;
  const hour24 = Number(match[4]);
  const hour = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return `${Number(match[2])}/${Number(match[3])}/${match[1]} ${hour}:${match[5]} ${suffix}`;
}

function cellText(object: DbObject, column: ColumnId): string {
  if (column === "name") return object.name;
  if (column === "schema") return object.schema;
  if (column === "created") return formatCreated(object.created ?? "");
  if (object.rowCount == null) return "";
  return object.rowCount.toLocaleString("en-US");
}

function compareNatural(left: DbObject, right: DbObject): number {
  const schema = left.schema.localeCompare(right.schema, undefined, { sensitivity: "base" });
  if (schema !== 0) return schema;
  return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
}

function compareColumn(left: DbObject, right: DbObject, column: ColumnId): number {
  if (column === "rowCount") return (left.rowCount ?? -1) - (right.rowCount ?? -1);
  const a = column === "schema" ? left.schema : column === "created" ? left.created ?? "" : left.name;
  const b = column === "schema" ? right.schema : column === "created" ? right.created ?? "" : right.name;
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true });
}

function RowIcon(props: { folder: Folder }) {
  if (props.folder === "view") return <ViewIcon />;
  if (props.folder === "procedure") return <ProcedureIcon />;
  if (props.folder === "function") return <FunctionIcon />;
  return <TableIcon />;
}
