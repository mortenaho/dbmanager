import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { diagramToSql, parseDbml, tableKey, type DbmlTable } from "../sql/dbml";
import type { EngineKind } from "../types";

const CARD_W = 240;
const HEAD = 28;
const ROW = 22;

function packedPos(tables: DbmlTable[], index: number, width: number): { x: number; y: number } {
  const columns = Math.max(1, Math.floor((Math.max(width, 280) - 16) / 280));
  const tops = Array.from({ length: columns }, () => 24);
  let pos = { x: 24, y: 24 };
  for (let i = 0; i <= index && i < tables.length; i += 1) {
    let column = 0;
    for (let next = 1; next < columns; next += 1) {
      if (tops[next] < tops[column]) column = next;
    }
    pos = { x: 24 + column * 280, y: tops[column] };
    const height = HEAD + Math.max(tables[i].columns.length, 1) * ROW + 40;
    tops[column] = pos.y + height;
  }
  return pos;
}

export function DiagramDesigner(props: {
  dbml: string;
  engine: EngineKind;
  onDbml: (value: string) => void;
  onEngine: (engine: EngineKind) => void;
  onImplement: (sql: string) => void;
}) {
  const model = useMemo(() => parseDbml(props.dbml), [props.dbml]);
  const sql = useMemo(() => diagramToSql(model, props.engine), [model, props.engine]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [stageWidth, setStageWidth] = useState(640);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ key: string; dx: number; dy: number } | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const apply = () => setStageWidth(stage.clientWidth);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      const stage = stageRef.current;
      const active = drag.current;
      if (!stage || !active) return;
      const rect = stage.getBoundingClientRect();
      const x = Math.max(8, event.clientX - rect.left + stage.scrollLeft - active.dx);
      const y = Math.max(8, event.clientY - rect.top + stage.scrollTop - active.dy);
      setPositions((current) => ({ ...current, [active.key]: { x, y } }));
    };
    const up = () => {
      drag.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, []);

  const placed = model.tables.map((table, index) => {
    const key = tableKey(table.schema, table.name);
    const fallback = positions[key] ? null : packedPos(model.tables, index, stageWidth);
    return { table, key, pos: positions[key] ?? fallback ?? { x: 24, y: 24 } };
  });
  const bounds = placed.reduce(
    (size, item) => ({
      w: Math.max(size.w, item.pos.x + CARD_W + 48),
      h: Math.max(size.h, item.pos.y + HEAD + item.table.columns.length * ROW + 48),
    }),
    { w: 640, h: 420 },
  );
  const lines = model.refs.flatMap((ref) => {
    const from = placed.find((item) => same(item.table, ref.fromSchema, ref.fromTable));
    const to = placed.find((item) => same(item.table, ref.toSchema, ref.toTable));
    if (!from || !to) return [];
    const fromRow = from.table.columns.findIndex((column) => column.name.toLowerCase() === ref.fromColumn.toLowerCase());
    const toRow = to.table.columns.findIndex((column) => column.name.toLowerCase() === ref.toColumn.toLowerCase());
    if (fromRow < 0 || toRow < 0) return [];
    const y1 = from.pos.y + HEAD + fromRow * ROW + ROW / 2;
    const y2 = to.pos.y + HEAD + toRow * ROW + ROW / 2;
    const forward = from.pos.x <= to.pos.x;
    const x1 = forward ? from.pos.x + CARD_W : from.pos.x;
    const x2 = forward ? to.pos.x : to.pos.x + CARD_W;
    const bend = Math.max(36, Math.abs(x2 - x1) / 2);
    const c1 = x1 + (forward ? bend : -bend);
    const c2 = x2 + (forward ? -bend : bend);
    return [{ d: `M ${x1} ${y1} C ${c1} ${y1}, ${c2} ${y2}, ${x2} ${y2}` }];
  });

  function startDrag(event: ReactMouseEvent, key: string, pos: { x: number; y: number }) {
    const stage = stageRef.current;
    if (!stage || event.button !== 0) return;
    const rect = stage.getBoundingClientRect();
    drag.current = {
      key,
      dx: event.clientX - rect.left + stage.scrollLeft - pos.x,
      dy: event.clientY - rect.top + stage.scrollTop - pos.y,
    };
  }

  return (
    <div className="diagram-designer">
      <div className="diagram-bar">
        <span className="diagram-title">Database Design</span>
        <span className="diagram-count">
          {model.tables.length} tables, {model.refs.length} relationships
        </span>
        <span className="spacer" />
        <label>
          Engine
          <select value={props.engine} onChange={(event) => props.onEngine(event.target.value as EngineKind)}>
            <option value="mssql">SQL Server</option>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>
        </label>
        <button type="button" className="diagram-go" disabled={model.tables.length === 0 || sql.trim() === ""} onClick={() => props.onImplement(sql)}>
          Implement
        </button>
      </div>
      <div className="diagram-body">
        <textarea
          className="diagram-code"
          spellCheck={false}
          wrap="off"
          value={props.dbml}
          onChange={(event) => props.onDbml(event.target.value)}
          aria-label="Database design"
        />
        <div className="diagram-stage" ref={stageRef}>
          <div className="diagram-sheet" style={{ width: bounds.w, height: bounds.h }}>
            <svg className="diagram-lines" width={bounds.w} height={bounds.h}>
              {lines.map((line, index) => (
                <path key={index} d={line.d} />
              ))}
            </svg>
            {placed.map((item) => (
              <article key={item.key} className="diagram-card" style={{ left: item.pos.x, top: item.pos.y }}>
                <header onMouseDown={(event) => startDrag(event, item.key, item.pos)}>
                  {item.table.schema ? `${item.table.schema}.${item.table.name}` : item.table.name}
                </header>
                {item.table.columns.map((column) => {
                  const fk = model.refs.some(
                    (ref) =>
                      same(item.table, ref.fromSchema, ref.fromTable) && ref.fromColumn.toLowerCase() === column.name.toLowerCase(),
                  );
                  const mark = column.pk ? "PK" : fk ? "FK" : "";
                  return (
                    <div key={column.name} className="diagram-col">
                      <span className="mark">{mark}</span>
                      <span className="col-name">{column.name}</span>
                      <span className="type">{column.type}</span>
                    </div>
                  );
                })}
              </article>
            ))}
          </div>
        </div>
      </div>
      {model.errors.length > 0 ? (
        <div className="diagram-errors">
          {model.errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function same(table: DbmlTable, schema: string, name: string): boolean {
  if (table.name.toLowerCase() !== name.toLowerCase()) return false;
  if (!schema || !table.schema) return true;
  return table.schema.toLowerCase() === schema.toLowerCase();
}
