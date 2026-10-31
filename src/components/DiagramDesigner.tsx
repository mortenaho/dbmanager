import Editor, { type OnMount } from "@monaco-editor/react";
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import {
  DBML_SNIPPETS,
  decodeDesign,
  diagramToSql,
  encodeDesign,
  insertColumnSnippet,
  parseDbml,
  tableKey,
  type DbmlRef,
  type DbmlTable,
  type DesignPoint,
  type RefEnd,
} from "../sql/dbml";
import { dbmlHints, registerDbmlEditor, type DbmlHint } from "../sql/dbmlEditor";
import { dbmlEditorTheme, type ColorScheme } from "../theme";
import { errorText, type EngineKind } from "../types";

const hintKey = { tab: 2, enter: 3, escape: 9, space: 10, up: 16, down: 18, ctrl: 2048 };
import {
  ArrangeIcon,
  HistoryIcon,
  ImplementIcon,
  LinkIcon,
  ManyToManyIcon,
  OneToManyIcon,
  OneToOneIcon,
  OpenIcon,
  PrimaryKeyIcon,
  SaveIcon,
  TableIcon,
  UniqueIcon,
} from "./Icons";

function SnippetIcon({ id }: { id: string }) {
  if (id === "table") return <TableIcon size={14} />;
  if (id === "pk") return <PrimaryKeyIcon size={14} />;
  if (id === "fk") return <LinkIcon size={14} />;
  if (id === "ref") return <OneToManyIcon size={14} />;
  if (id === "unique") return <UniqueIcon size={14} />;
  if (id === "timestamps") return <HistoryIcon size={14} />;
  if (id === "ref-one") return <OneToOneIcon size={14} />;
  if (id === "ref-many") return <ManyToManyIcon size={14} />;
  return <OneToManyIcon size={14} />;
}

const CARD_W = 240;
const HEAD = 28;
const ROW = 22;
const GAP_X = 108;
const GAP_Y = 40;
const MARGIN = 32;
const STUB = 22;

export function DiagramDesigner(props: {
  dbml: string;
  engine: EngineKind;
  theme?: ColorScheme;
  onDbml: (value: string) => void;
  onEngine: (engine: EngineKind) => void;
  onImplement: (sql: string) => void;
  onSaveFile: (fileName: string, contents: string) => Promise<"saved" | "cancelled">;
  onOpenFile: () => Promise<{ name: string; contents: string } | null>;
}) {
  const model = useMemo(() => parseDbml(props.dbml), [props.dbml]);
  const sql = useMemo(() => diagramToSql(model, props.engine), [model, props.engine]);
  const [positions, setPositions] = useState<Record<string, DesignPoint>>({});
  const [fileName, setFileName] = useState("DatabaseDesign.dbdesign");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [editorWidth, setEditorWidth] = useState(360);
  const stageRef = useRef<HTMLDivElement>(null);
  const codeRef = useRef<Parameters<OnMount>[0] | null>(null);
  const drag = useRef<{ key: string; dx: number; dy: number } | null>(null);

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

  const auto = useMemo(() => layoutTables(model.tables, model.refs), [model]);
  const placed = model.tables.map((table) => {
    const key = tableKey(table.schema, table.name);
    return { table, key, pos: positions[key] ?? auto[key] ?? { x: MARGIN, y: MARGIN } };
  });
  const lines = relationshipLines(placed, model.refs);
  const bounds = lines.reduce(
    (size, line) => ({
      w: Math.max(size.w, line.right + 36),
      h: Math.max(size.h, line.bottom + 36),
    }),
    placed.reduce(
      (size, item) => ({
        w: Math.max(size.w, item.pos.x + CARD_W + 48),
        h: Math.max(size.h, item.pos.y + HEAD + item.table.columns.length * ROW + 48),
      }),
      { w: 640, h: 420 },
    ),
  );

  function startDrag(event: ReactMouseEvent, key: string, pos: DesignPoint) {
    const stage = stageRef.current;
    if (!stage || event.button !== 0) return;
    const rect = stage.getBoundingClientRect();
    drag.current = {
      key,
      dx: event.clientX - rect.left + stage.scrollLeft - pos.x,
      dy: event.clientY - rect.top + stage.scrollTop - pos.y,
    };
  }

  function arrange() {
    setPositions(layoutTables(model.tables, model.refs));
    if (stageRef.current) stageRef.current.scrollTo(0, 0);
    setNote("Arranged tables by relationship.");
  }

  const engineRef = useRef(props.engine);
  engineRef.current = props.engine;
  const suggestRef = useRef<SuggestMenu | null>(null);
  const [suggest, setSuggest] = useState<SuggestMenu | null>(null);

  function closeSuggest() {
    suggestRef.current = null;
    setSuggest(null);
  }

  function applyHint(editor: Parameters<OnMount>[0], menu: SuggestMenu, item: DbmlHint) {
    editor.executeEdits("hint", [
      {
        range: {
          startLineNumber: menu.line,
          endLineNumber: menu.line,
          startColumn: menu.startColumn,
          endColumn: menu.endColumn,
        },
        text: item.insert,
      },
    ]);
    editor.setPosition({ lineNumber: menu.line, column: menu.startColumn + item.insert.length });
    closeSuggest();
    editor.focus();
  }

  function placeCursor(offset: number, length: number) {
    const apply = (tries: number) => {
      const codeEditor = codeRef.current;
      const model = codeEditor?.getModel();
      if (!codeEditor || !model || model.getValueLength() !== length) {
        if (tries > 0) requestAnimationFrame(() => apply(tries - 1));
        return;
      }
      const position = model.getPositionAt(Math.min(offset, model.getValueLength()));
      codeEditor.setPosition(position);
      codeEditor.revealPositionInCenterIfOutsideViewport(position);
      codeEditor.focus();
    };
    requestAnimationFrame(() => apply(8));
  }

  function insertSnippet(text: string) {
    const codeEditor = codeRef.current;
    const model = codeEditor?.getModel();
    const value = model?.getValue() ?? props.dbml;
    const selection = codeEditor?.getSelection();
    const start = selection && model ? model.getOffsetAt(selection.getStartPosition()) : value.length;
    const end = selection && model ? model.getOffsetAt(selection.getEndPosition()) : value.length;
    if (!/^\s*(table|ref)\b/i.test(text)) {
      const placedColumn = insertColumnSnippet(value, start, text);
      if (placedColumn) {
        props.onDbml(placedColumn.dbml);
        placeCursor(placedColumn.cursor, placedColumn.dbml.length);
        return;
      }
    }
    const lead = start > 0 && value[start - 1] !== "\n" ? "\n" : "";
    const body = text.endsWith("\n") ? text : `${text}\n`;
    const chunk = `${lead}${body}`;
    const next = value.slice(0, start) + chunk + value.slice(end);
    props.onDbml(next);
    placeCursor(start + chunk.length, next.length);
  }

  async function saveDesign() {
    const layout: Record<string, DesignPoint> = {};
    for (const item of placed) layout[item.key] = item.pos;
    setBusy(true);
    setNote("");
    try {
      const saved = await props.onSaveFile(fileName, encodeDesign({ engine: props.engine, dbml: props.dbml, positions: layout }));
      if (saved === "saved") setNote(`Saved ${fileName}.`);
    } catch (reason) {
      setNote(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  async function openDesign() {
    setBusy(true);
    setNote("");
    try {
      const file = await props.onOpenFile();
      if (!file) return;
      const design = decodeDesign(file.contents);
      props.onDbml(design.dbml);
      if (design.engine) props.onEngine(design.engine);
      setPositions(design.positions);
      const name = /\.dbdesign$/i.test(file.name) ? file.name : file.name.replace(/\.[^.]+$/, "") + ".dbdesign";
      setFileName(name || "DatabaseDesign.dbdesign");
      setNote(`Opened ${file.name}.`);
    } catch (reason) {
      setNote(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  function startEditorResize(event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = editorWidth;
    const move = (ev: MouseEvent) => {
      const limit = Math.max(420, window.innerWidth - 280);
      setEditorWidth(Math.min(limit, Math.max(240, startWidth + ev.clientX - startX)));
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  return (
    <div className="diagram-designer">
      <div className="diagram-bar">
        <span className="diagram-title">Database Design</span>
        <span className="diagram-count" title={fileName}>
          {fileName}
          {" · "}
          {model.tables.length} tables, {model.refs.length} relationships
        </span>
        <span className="spacer" />
        <button type="button" className="diagram-tool" disabled={busy} onClick={() => void saveDesign()}>
          <SaveIcon />
          Save
        </button>
        <button type="button" className="diagram-tool" disabled={busy} onClick={() => void openDesign()}>
          <OpenIcon />
          Open
        </button>
        <button type="button" className="diagram-tool" disabled={busy || model.tables.length === 0} onClick={arrange}>
          <ArrangeIcon />
          Arrange
        </button>
        <label>
          Engine
          <select value={props.engine} onChange={(event) => props.onEngine(event.target.value as EngineKind)}>
            <option value="mssql">SQL Server</option>
            <option value="postgres">PostgreSQL</option>
            <option value="mysql">MySQL</option>
          </select>
        </label>
        <button type="button" className="diagram-go" disabled={model.tables.length === 0 || sql.trim() === ""} onClick={() => props.onImplement(sql)}>
          <ImplementIcon />
          Implement
        </button>
      </div>
      <div className="diagram-body">
        <div className="diagram-editor" style={{ width: editorWidth }}>
          <div className="diagram-snippets">
            <span>Snippets</span>
            {DBML_SNIPPETS.map((snippet) => (
              <button key={snippet.id} type="button" title={snippet.title} onClick={() => insertSnippet(snippet.text)}>
                <SnippetIcon id={snippet.id} />
                {snippet.label}
              </button>
            ))}
          </div>
          <div className="diagram-code">
            <Editor
              language="dbml"
              theme={dbmlEditorTheme(props.theme ?? "light")}
              height="100%"
              value={props.dbml}
              beforeMount={registerDbmlEditor}
              onChange={(value) => props.onDbml(value ?? "")}
              onMount={(codeEditor) => {
                codeRef.current = codeEditor;
                const showHints = () => {
                  const model = codeEditor.getModel();
                  const position = codeEditor.getPosition();
                  if (!model || !position) {
                    closeSuggest();
                    return;
                  }
                  const before = model.getLineContent(position.lineNumber).slice(0, position.column - 1);
                  const items = dbmlHints(engineRef.current, before, model.getValue());
                  const coords = codeEditor.getScrolledVisiblePosition(position);
                  const box = codeEditor.getDomNode()?.getBoundingClientRect();
                  if (items.length === 0 || !coords || !box) {
                    closeSuggest();
                    return;
                  }
                  const word = model.getWordUntilPosition(position);
                  const menuHeight = Math.min(items.length, 8) * 32 + 8;
                  const below = box.top + coords.top + coords.height + 4;
                  const top = below + menuHeight > window.innerHeight ? Math.max(8, box.top + coords.top - menuHeight - 4) : below;
                  const menu: SuggestMenu = {
                    items,
                    index: 0,
                    top,
                    left: Math.max(8, Math.min(box.left + coords.left, window.innerWidth - 220)),
                    line: position.lineNumber,
                    startColumn: word.startColumn,
                    endColumn: word.endColumn,
                  };
                  suggestRef.current = menu;
                  setSuggest(menu);
                };
                codeEditor.onDidChangeModelContent(showHints);
                codeEditor.onDidChangeCursorPosition(showHints);
                codeEditor.addCommand(hintKey.ctrl | hintKey.space, showHints);
                codeEditor.onKeyDown((event) => {
                  const menu = suggestRef.current;
                  if (!menu) return;
                  if (event.keyCode === hintKey.down || event.keyCode === hintKey.up) {
                    event.preventDefault();
                    event.stopPropagation();
                    const delta = event.keyCode === hintKey.down ? 1 : -1;
                    const next = { ...menu, index: (menu.index + delta + menu.items.length) % menu.items.length };
                    suggestRef.current = next;
                    setSuggest(next);
                    return;
                  }
                  if (event.keyCode === hintKey.enter || event.keyCode === hintKey.tab) {
                    event.preventDefault();
                    event.stopPropagation();
                    applyHint(codeEditor, menu, menu.items[menu.index]);
                    return;
                  }
                  if (event.keyCode === hintKey.escape) {
                    event.preventDefault();
                    event.stopPropagation();
                    closeSuggest();
                  }
                });
              }}
              options={{
                fontFamily: "Consolas, Liberation Mono, monospace",
                fontSize: 13,
                lineHeight: 20,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: "off",
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
                padding: { top: 6, bottom: 6 },
                lineNumbersMinChars: 3,
                glyphMargin: false,
                folding: true,
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                renderLineHighlight: "line",
                matchBrackets: "always",
                autoClosingBrackets: "always",
                autoClosingQuotes: "always",
                fixedOverflowWidgets: true,
                wordBasedSuggestions: "off",
                suggestOnTriggerCharacters: false,
                quickSuggestions: false,
                ariaLabel: "Database design",
              }}
            />
          </div>
        </div>
        <div className="splitter-v" role="separator" aria-orientation="vertical" aria-label="Resize code editor" onMouseDown={startEditorResize} />
        <div className="diagram-canvas">
          <div className="diagram-stage" ref={stageRef}>
          <div className="diagram-sheet" style={{ width: bounds.w, height: bounds.h }}>
            <svg className="diagram-lines" width={bounds.w} height={bounds.h}>
              {lines.map((line) => (
                <g key={line.key}>
                  <title>{line.title}</title>
                  <path d={line.d} />
                  {line.marks.map((mark) => (
                    <path key={mark.key} d={mark.d} />
                  ))}
                  {line.labels.map((label) => (
                    <text key={label.key} x={label.x} y={label.y} textAnchor="middle" dominantBaseline="middle">
                      {label.text}
                    </text>
                  ))}
                </g>
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
          <div className="diagram-legend">
            <LegendRow left="one" right="one" label="One to one" />
            <LegendRow left="one" right="many" label="One to many" />
            <LegendRow left="many" right="many" label="Many to many" />
          </div>
        </div>
      </div>
      {note || model.errors.length > 0 ? (
        <div className={model.errors.length > 0 ? "diagram-errors" : "diagram-note"}>
          {note ? <div>{note}</div> : null}
          {model.errors.map((error) => (
            <div key={error}>{error}</div>
          ))}
        </div>
      ) : null}
      {suggest
        ? createPortal(
            <div className="dbml-suggest" style={{ top: suggest.top, left: suggest.left }} role="listbox">
              {suggest.items.map((item, index) => (
                <button
                  key={`${item.detail}-${item.label}`}
                  type="button"
                  role="option"
                  aria-selected={index === suggest.index}
                  className={index === suggest.index ? "on" : ""}
                  ref={index === suggest.index ? (node) => node?.scrollIntoView({ block: "nearest" }) : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => {
                    const next = { ...suggest, index };
                    suggestRef.current = next;
                    setSuggest(next);
                  }}
                  onClick={() => {
                    const editor = codeRef.current;
                    if (editor) applyHint(editor, suggest, item);
                  }}
                >
                  <span>{item.label}</span>
                  <small>{item.detail}</small>
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

type SuggestMenu = {
  items: DbmlHint[];
  index: number;
  top: number;
  left: number;
  line: number;
  startColumn: number;
  endColumn: number;
};

type Side = "left" | "right" | "top" | "bottom";
type Point = { x: number; y: number };
type Box = { key: string; x: number; y: number; w: number; h: number };
type Placed = { table: DbmlTable; key: string; pos: DesignPoint };
type RelLine = {
  key: string;
  title: string;
  d: string;
  marks: Array<{ key: string; d: string }>;
  labels: Array<{ key: string; x: number; y: number; text: string }>;
  right: number;
  bottom: number;
};

function relationshipLines(placed: Placed[], refs: DbmlRef[]): RelLine[] {
  const boxes = placed.map(cardBox);
  const drafts: Array<{
    ref: DbmlRef;
    from: Placed;
    to: Placed;
    fromRow: number;
    toRow: number;
    fromSide: Side;
    toSide: Side;
  }> = [];
  for (const ref of refs) {
    const from = placed.find((item) => same(item.table, ref.fromSchema, ref.fromTable));
    const to = placed.find((item) => same(item.table, ref.toSchema, ref.toTable));
    if (!from || !to) continue;
    const fromRow = from.table.columns.findIndex((column) => column.name.toLowerCase() === ref.fromColumn.toLowerCase());
    const toRow = to.table.columns.findIndex((column) => column.name.toLowerCase() === ref.toColumn.toLowerCase());
    if (fromRow < 0 || toRow < 0) continue;
    const fromBox = boxes.find((box) => box.key === from.key);
    const toBox = boxes.find((box) => box.key === to.key);
    if (!fromBox || !toBox) continue;
    const sides = from.key === to.key ? { fromSide: "right" as Side, toSide: "right" as Side } : chooseSides(fromBox, toBox);
    drafts.push({ ref, from, to, fromRow, toRow, ...sides });
  }
  const fromSlots = slotOf(drafts.map((draft) => ({ id: draft, port: `${draft.from.key}:${draft.fromSide}`, at: draft.fromRow })));
  const toSlots = slotOf(drafts.map((draft) => ({ id: draft, port: `${draft.to.key}:${draft.toSide}`, at: draft.toRow })));
  const lanes = slotOf(drafts.map((draft) => ({ id: draft, port: `${draft.from.key}|${draft.to.key}|${draft.fromSide}|${draft.toSide}`, at: draft.fromRow })));
  const seenMarks = new Set<string>();
  const seenLabels = new Set<string>();
  return drafts.map((draft) => {
    const fromBox = boxes.find((box) => box.key === draft.from.key)!;
    const toBox = boxes.find((box) => box.key === draft.to.key)!;
    const fromSlot = fromSlots.get(draft) ?? 0;
    const toSlot = toSlots.get(draft) ?? 0;
    const fromAnchor = anchorPoint(fromBox, draft.fromSide, draft.fromRow, toBox, fromSlot, portCount(drafts, draft.from.key, draft.fromSide, "from"));
    const toAnchor = anchorPoint(toBox, draft.toSide, draft.toRow, fromBox, toSlot, portCount(drafts, draft.to.key, draft.toSide, "to"));
    const obstacles = boxes
      .filter((box) => box.key !== fromBox.key && box.key !== toBox.key)
      .map((box) => ({ ...box, x: box.x - 8, y: box.y - 8, w: box.w + 16, h: box.h + 16 }));
    const points =
      fromBox.key === toBox.key
        ? selfLoop(fromBox, fromAnchor, toAnchor, lanes.get(draft) ?? 0)
        : routePoints(fromAnchor, draft.fromSide, toAnchor, draft.toSide, lanes.get(draft) ?? 0, obstacles);
    const title = relationTitle(draft.ref.fromEnd, draft.ref.toEnd);
    let right = 0;
    let bottom = 0;
    for (const point of points) {
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
    const fromLabel = labelAt(fromAnchor, draft.fromSide);
    const toLabel = labelAt(toAnchor, draft.toSide);
    right = Math.max(right, fromLabel.x + 12, toLabel.x + 12);
    bottom = Math.max(bottom, fromLabel.y + 12, toLabel.y + 12);
    const key = `${draft.from.key}.${draft.ref.fromColumn}-${draft.to.key}.${draft.ref.toColumn}`;
    const marks = [
      { key: "from", d: cardinalityMark(fromAnchor, draft.fromSide, draft.ref.fromEnd) },
      { key: "to", d: cardinalityMark(toAnchor, draft.toSide, draft.ref.toEnd) },
    ].filter((mark) => keepOnce(seenMarks, mark.d));
    const labels = [
      { key: "from", ...fromLabel, text: draft.ref.fromEnd === "one" ? "1" : "N" },
      { key: "to", ...toLabel, text: draft.ref.toEnd === "one" ? "1" : "N" },
    ].filter((label) => keepOnce(seenLabels, `${n(label.x)}:${n(label.y)}:${label.text}`));
    return { key, title, d: toPath(points), marks, labels, right, bottom };
  });
}

function keepOnce(seen: Set<string>, id: string): boolean {
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}

function portCount(
  drafts: Array<{ from: Placed; to: Placed; fromSide: Side; toSide: Side }>,
  key: string,
  side: Side,
  end: "from" | "to",
): number {
  return drafts.filter((draft) => (end === "from" ? draft.from.key === key && draft.fromSide === side : draft.to.key === key && draft.toSide === side)).length;
}

function slotOf<T>(items: Array<{ id: T; port: string; at: number }>): Map<T, number> {
  const groups = new Map<string, Array<{ id: T; at: number }>>();
  for (const item of items) {
    const group = groups.get(item.port) ?? [];
    group.push(item);
    groups.set(item.port, group);
  }
  const slots = new Map<T, number>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.at - b.at);
    group.forEach((item, index) => slots.set(item.id, index));
  }
  return slots;
}

function routePoints(from: Point, fromSide: Side, to: Point, toSide: Side, lane: number, obstacles: Box[]): Point[] {
  const start = shift(from, fromSide, STUB);
  const end = shift(to, toSide, STUB);
  const fromHorizontal = fromSide === "left" || fromSide === "right";
  const toHorizontal = toSide === "left" || toSide === "right";
  const shiftLane = lane * 14;
  const options: Point[][] = [];
  if (fromHorizontal && toHorizontal) {
    const mid = (start.x + end.x) / 2 + shiftLane;
    options.push([{ x: mid, y: start.y }, { x: mid, y: end.y }]);
    options.push(...detours(start, end, obstacles, lane, "h"));
  } else if (!fromHorizontal && !toHorizontal) {
    const mid = (start.y + end.y) / 2 + shiftLane;
    options.push([{ x: start.x, y: mid }, { x: end.x, y: mid }]);
    options.push(...detours(start, end, obstacles, lane, "v"));
  } else {
    options.push([{ x: fromHorizontal ? end.x : start.x, y: fromHorizontal ? start.y : end.y }]);
    options.push([{ x: fromHorizontal ? start.x : end.x, y: fromHorizontal ? end.y : start.y }]);
    options.push(...detours(start, end, obstacles, lane, "h"));
    options.push(...detours(start, end, obstacles, lane, "v"));
  }
  for (const mid of options) {
    const poly = dedupe([from, start, ...mid, end, to]);
    if (!polylineHits([start, ...mid, end], obstacles)) return poly;
  }
  return dedupe([from, start, ...(options[0] ?? []), end, to]);
}

function detours(start: Point, end: Point, obstacles: Box[], lane: number, axis: "h" | "v"): Point[][] {
  const pad = 20 + lane * 14;
  if (axis === "h") {
    let bottom = Math.max(start.y, end.y);
    let top = Math.min(start.y, end.y);
    const x1 = Math.min(start.x, end.x);
    const x2 = Math.max(start.x, end.x);
    for (const box of obstacles) {
      if (box.x + box.w < x1 || box.x > x2) continue;
      bottom = Math.max(bottom, box.y + box.h);
      top = Math.min(top, box.y);
    }
    const routes: Point[][] = [[{ x: start.x, y: bottom + pad }, { x: end.x, y: bottom + pad }]];
    if (top - pad >= 12) routes.push([{ x: start.x, y: top - pad }, { x: end.x, y: top - pad }]);
    return routes;
  }
  let right = Math.max(start.x, end.x);
  let left = Math.min(start.x, end.x);
  const y1 = Math.min(start.y, end.y);
  const y2 = Math.max(start.y, end.y);
  for (const box of obstacles) {
    if (box.y + box.h < y1 || box.y > y2) continue;
    right = Math.max(right, box.x + box.w);
    left = Math.min(left, box.x);
  }
  const routes: Point[][] = [[{ x: right + pad, y: start.y }, { x: right + pad, y: end.y }]];
  if (left - pad >= 12) routes.push([{ x: left - pad, y: start.y }, { x: left - pad, y: end.y }]);
  return routes;
}

function selfLoop(box: Box, from: Point, to: Point, lane: number): Point[] {
  const x = box.x + box.w + STUB + 16 + lane * 14;
  return [from, { x, y: from.y }, { x, y: to.y }, to];
}

function polylineHits(points: Point[], boxes: Box[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    for (const box of boxes) {
      if (x2 > box.x && x1 < box.x + box.w && y2 > box.y && y1 < box.y + box.h) return true;
    }
  }
  return false;
}

function dedupe(points: Point[]): Point[] {
  const next: Point[] = [];
  for (const point of points) {
    const prev = next[next.length - 1];
    if (prev && Math.abs(prev.x - point.x) < 0.5 && Math.abs(prev.y - point.y) < 0.5) continue;
    next.push(point);
  }
  return next;
}

function toPath(points: Point[]): string {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${n(point.x)} ${n(point.y)}`).join(" ");
}

function chooseSides(from: Box, to: Box): { fromSide: Side; toSide: Side } {
  const options: Array<{ gap: number; fromSide: Side; toSide: Side }> = [
    { gap: to.x - (from.x + from.w), fromSide: "right", toSide: "left" },
    { gap: from.x - (to.x + to.w), fromSide: "left", toSide: "right" },
    { gap: to.y - (from.y + from.h), fromSide: "bottom", toSide: "top" },
    { gap: from.y - (to.y + to.h), fromSide: "top", toSide: "bottom" },
  ];
  options.sort((a, b) => b.gap - a.gap);
  return { fromSide: options[0].fromSide, toSide: options[0].toSide };
}

function anchorPoint(box: Box, side: Side, row: number, toward: Box, slot: number, count: number): Point {
  if (side === "left" || side === "right") {
    const y = clamp(box.y + HEAD + row * ROW + ROW / 2, box.y + 8, box.y + box.h - 8);
    return { x: side === "left" ? box.x : box.x + box.w, y };
  }
  const spread = count > 1 ? (slot - (count - 1) / 2) * 16 : 0;
  const x = clamp(toward.x + toward.w / 2 + spread, box.x + 16, box.x + box.w - 16);
  return { x, y: side === "top" ? box.y : box.y + box.h };
}

function cardinalityMark(edge: Point, side: Side, end: RefEnd): string {
  const away = outward(side);
  const px = -away.y;
  const py = away.x;
  if (end === "one") {
    const x = edge.x + away.x * 5;
    const y = edge.y + away.y * 5;
    return `M ${n(x + px * 6)} ${n(y + py * 6)} L ${n(x - px * 6)} ${n(y - py * 6)}`;
  }
  const jx = edge.x + away.x * 13;
  const jy = edge.y + away.y * 13;
  const spread = 6;
  return [
    `M ${n(jx)} ${n(jy)} L ${n(edge.x + px * spread)} ${n(edge.y + py * spread)}`,
    `M ${n(jx)} ${n(jy)} L ${n(edge.x)} ${n(edge.y)}`,
    `M ${n(jx)} ${n(jy)} L ${n(edge.x - px * spread)} ${n(edge.y - py * spread)}`,
  ].join(" ");
}

function labelAt(edge: Point, side: Side): Point {
  const away = outward(side);
  const px = -away.y;
  const py = away.x;
  const sign = side === "left" || side === "bottom" ? 1 : -1;
  return {
    x: edge.x + away.x * 14 + px * 11 * sign,
    y: edge.y + away.y * 14 + py * 11 * sign,
  };
}

function outward(side: Side): Point {
  if (side === "left") return { x: -1, y: 0 };
  if (side === "right") return { x: 1, y: 0 };
  if (side === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function shift(point: Point, side: Side, distance: number): Point {
  const away = outward(side);
  return { x: point.x + away.x * distance, y: point.y + away.y * distance };
}

function relationTitle(fromEnd: RefEnd, toEnd: RefEnd): string {
  if (fromEnd === "one" && toEnd === "one") return "One to one";
  if (fromEnd === "many" && toEnd === "many") return "Many to many";
  return "One to many";
}

function LegendRow(props: { left: RefEnd; right: RefEnd; label: string }) {
  return (
    <div>
      <svg width="58" height="16" viewBox="0 0 58 16" aria-hidden="true">
        <path d="M 6 8 H 52" />
        <path d={cardinalityMark({ x: 6, y: 8 }, "right", props.left)} />
        <path d={cardinalityMark({ x: 52, y: 8 }, "left", props.right)} />
      </svg>
      <span>{props.label}</span>
    </div>
  );
}

function layoutTables(tables: DbmlTable[], refs: DbmlRef[]): Record<string, DesignPoint> {
  const positions: Record<string, DesignPoint> = {};
  const parents: number[][] = tables.map(() => []);
  const neighbors: number[][] = tables.map(() => []);
  const linked = new Set<number>();
  refs.forEach((ref) => {
    const child = tables.findIndex((table) => same(table, ref.fromSchema, ref.fromTable));
    const parent = tables.findIndex((table) => same(table, ref.toSchema, ref.toTable));
    if (child < 0 || parent < 0) return;
    linked.add(child);
    linked.add(parent);
    if (child === parent) return;
    if (!parents[child].includes(parent)) parents[child].push(parent);
    if (!neighbors[child].includes(parent)) neighbors[child].push(parent);
    if (!neighbors[parent].includes(child)) neighbors[parent].push(child);
  });

  const seen = new Set<number>();
  const components: number[][] = [];
  for (let index = 0; index < tables.length; index += 1) {
    if (seen.has(index) || !linked.has(index)) continue;
    const component: number[] = [];
    const stack = [index];
    seen.add(index);
    while (stack.length > 0) {
      const current = stack.pop() ?? index;
      component.push(current);
      for (const next of neighbors[current]) {
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(next);
      }
    }
    components.push(component);
  }

  let cursorY = MARGIN;
  for (const component of components) {
    const rank = new Map<number, number>();
    const visiting = new Set<number>();
    const depth = (index: number): number => {
      const cached = rank.get(index);
      if (cached !== undefined) return cached;
      if (visiting.has(index)) return 0;
      visiting.add(index);
      const localParents = parents[index].filter((parent) => component.includes(parent));
      const value = localParents.length === 0 ? 0 : Math.max(...localParents.map((parent) => depth(parent) + 1));
      visiting.delete(index);
      rank.set(index, value);
      return value;
    };
    component.forEach((index) => depth(index));
    const columns = new Map<number, number[]>();
    let maxRank = 0;
    for (const index of component) {
      const level = rank.get(index) ?? 0;
      maxRank = Math.max(maxRank, level);
      const column = columns.get(level) ?? [];
      column.push(index);
      columns.set(level, column);
    }
    const top = cursorY;
    for (let level = 0; level <= maxRank; level += 1) {
      const column = columns.get(level) ?? [];
      const previous = columns.get(level - 1) ?? [];
      column.sort((a, b) => {
        const delta = bary(a, previous, parents) - bary(b, previous, parents);
        if (Math.abs(delta) > 0.01) return delta;
        if (parents[b].includes(a)) return -1;
        if (parents[a].includes(b)) return 1;
        return a - b;
      });
      let y = top;
      const x = MARGIN + level * (CARD_W + GAP_X);
      for (const index of column) {
        positions[tableKey(tables[index].schema, tables[index].name)] = { x, y };
        y += cardHeight(tables[index]) + GAP_Y;
      }
      cursorY = Math.max(cursorY, y);
    }
    cursorY += 28;
  }

  const islands = tables.map((_, index) => index).filter((index) => !linked.has(index));
  const islandColumns = Math.max(1, Math.min(3, islands.length));
  const tops = Array.from({ length: islandColumns }, () => cursorY);
  islands.forEach((index) => {
    let column = 0;
    for (let next = 1; next < islandColumns; next += 1) if (tops[next] < tops[column]) column = next;
    positions[tableKey(tables[index].schema, tables[index].name)] = { x: MARGIN + column * (CARD_W + GAP_X), y: tops[column] };
    tops[column] += cardHeight(tables[index]) + GAP_Y;
  });
  return positions;
}

function bary(index: number, previous: number[], parents: number[][]): number {
  const weights = parents[index].map((parent) => previous.indexOf(parent)).filter((at) => at >= 0);
  if (weights.length === 0) return index;
  return weights.reduce((sum, value) => sum + value, 0) / weights.length;
}

function cardBox(item: Placed): Box {
  return { key: item.key, x: item.pos.x, y: item.pos.y, w: CARD_W, h: cardHeight(item.table) };
}

function cardHeight(table: DbmlTable): number {
  return HEAD + Math.max(table.columns.length, 1) * ROW;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function n(value: number): number {
  return Math.round(value);
}

function same(table: DbmlTable, schema: string, name: string): boolean {
  if (table.name.toLowerCase() !== name.toLowerCase()) return false;
  if (!schema || !table.schema) return true;
  return table.schema.toLowerCase() === schema.toLowerCase();
}
