import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { QueryMessage, ResultSet } from "../types";
import { CopyIcon, CopyPlainIcon, ExcelIcon, JsonIcon, MessagesIcon, ResultsIcon, SelectAllIcon } from "./Icons";

type Props = {
  resultSets: ResultSet[];
  messages: QueryMessage[];
  activePane: "results" | "messages";
  onPane: (pane: "results" | "messages") => void;
  onExport: (format: "xlsx" | "json") => void;
};

type CellPos = { row: number; col: number };
type Selection =
  | { mode: "cells"; anchor: CellPos; focus: CellPos }
  | { mode: "rows"; anchor: number; rows: number[] }
  | { mode: "columns"; anchor: number; cols: number[] };
type DragKind = "cells" | "rows" | "columns";

const ROW_HEIGHT = 22;

export function ResultsPane({ resultSets, messages, activePane, onPane, onExport }: Props) {
  const grids = resultSets.filter((set) => set.columns.length > 0);
  const writes = resultSets.filter((set) => set.columns.length === 0);
  const hasError = messages.some((message) => message.level === "error");
  const hasWarn = !hasError && messages.some((message) => message.level === "warn");

  return (
    <div className="results">
      <div className="result-tabs">
        <button className={activePane === "results" ? "active" : ""} onClick={() => onPane("results")}>
          <ResultsIcon />
          Results
        </button>
        <button
          className={`${activePane === "messages" ? "active" : ""} ${hasError ? "has-error" : ""} ${hasWarn ? "has-warn" : ""}`}
          onClick={() => onPane("messages")}
        >
          <MessagesIcon />
          Messages
        </button>
        <span className="spacer" />
        <button className="export" type="button" disabled={grids.length === 0} onClick={() => onExport("xlsx")}>
          <ExcelIcon />
          Excel
        </button>
        <button className="export" type="button" disabled={grids.length === 0} onClick={() => onExport("json")}>
          <JsonIcon />
          JSON
        </button>
      </div>
      <div className="result-body">
        {activePane === "messages" ? (
          <div className="messages">
            {messages.length === 0 ? <div className="empty-results">No messages.</div> : null}
            {messages.map((message, index) => (
              <div key={index} className={`msg ${message.level}`}>
                {message.text}
              </div>
            ))}
          </div>
        ) : grids.length === 0 ? (
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty-results">The statement did not return a result set.</div>
            ) : (
              messages.map((message, index) => (
                <div key={index} className={`msg ${message.level}`}>
                  {message.text}
                </div>
              ))
            )}
          </div>
        ) : (
          <>
            {writes.map((set, index) => (
              <div key={`affected-${index}`} className="affected">
                {affectedText(set.rowsAffected)}
              </div>
            ))}
            {grids.map((set, index) => (
              <ResultGrid key={index} set={set} index={index} total={grids.length} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function ResultGrid({ set, index, total }: { set: ResultSet; index: number; total: number }) {
  const widths = useMemo(() => measure(set), [set]);
  const width = 46 + widths.reduce((sum, item) => sum + item, 0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(200);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState("");
  const drag = useRef<DragKind | null>(null);
  const pointer = useRef({ x: 0, y: 0 });
  const widthsRef = useRef(widths);
  const selectionRef = useRef(selection);
  const rowCountRef = useRef(set.rows.length);
  const noteTimer = useRef(0);
  widthsRef.current = widths;
  selectionRef.current = selection;
  rowCountRef.current = set.rows.length;

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setViewport(node.clientHeight));
    observer.observe(node);
    setViewport(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    setSelection(null);
    setMenu(null);
    setNote("");
  }, [set]);

  useEffect(() => {
    function paint() {
      const kind = drag.current;
      const body = bodyRef.current;
      if (!kind || !body) return;
      const hit = hitBody(body, pointer.current.x, pointer.current.y, widthsRef.current, rowCountRef.current);
      const col = hit.col < 0 ? 0 : hit.col;
      if (kind === "columns") {
        setSelection((current) => {
          if (!current || current.mode !== "columns") return current;
          return { mode: "columns", anchor: current.anchor, cols: inclusive(current.anchor, col) };
        });
        return;
      }
      if (kind === "rows") {
        setSelection((current) => {
          if (!current || current.mode !== "rows") return current;
          return { mode: "rows", anchor: current.anchor, rows: inclusive(current.anchor, hit.row) };
        });
        return;
      }
      setSelection((current) => {
        if (!current || current.mode !== "cells") return current;
        return { ...current, focus: { row: hit.row, col } };
      });
    }

    function onMove(event: MouseEvent) {
      pointer.current = { x: event.clientX, y: event.clientY };
      paint();
    }
    function onUp() {
      drag.current = null;
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    const timer = window.setInterval(() => {
      const body = bodyRef.current;
      if (!body || !drag.current || drag.current === "columns") return;
      const rect = body.getBoundingClientRect();
      const y = pointer.current.y;
      if (y < rect.top + 28) body.scrollTop -= 18;
      else if (y > rect.bottom - 28) body.scrollTop += 18;
      else return;
      paint();
    }, 40);
    return () => {
      drag.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!menu) return;
    function close(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Element && target.closest(".context-menu")) return;
      setMenu(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setMenu(null);
    }
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const count = Math.ceil(viewport / ROW_HEIGHT) + 8;
  const visible = set.rows.slice(start, start + count);
  const rowSet = selection?.mode === "rows" ? new Set(selection.rows) : null;
  const colSet = selection?.mode === "columns" ? new Set(selection.cols) : null;
  const cellRange =
    selection?.mode === "cells"
      ? {
          r1: Math.min(selection.anchor.row, selection.focus.row),
          r2: Math.max(selection.anchor.row, selection.focus.row),
          c1: Math.min(selection.anchor.col, selection.focus.col),
          c2: Math.max(selection.anchor.col, selection.focus.col),
        }
      : null;

  function cellSelected(row: number, col: number) {
    if (rowSet) return rowSet.has(row);
    if (colSet) return colSet.has(col);
    if (!cellRange) return false;
    return row >= cellRange.r1 && row <= cellRange.r2 && col >= cellRange.c1 && col <= cellRange.c2;
  }

  function headerSelected(col: number) {
    if (colSet?.has(col)) return true;
    return Boolean(
      cellRange &&
        set.rows.length > 0 &&
        cellRange.r1 === 0 &&
        cellRange.r2 === set.rows.length - 1 &&
        col >= cellRange.c1 &&
        col <= cellRange.c2,
    );
  }

  function rowHeaderSelected(row: number) {
    if (rowSet?.has(row)) return true;
    return Boolean(
      cellRange &&
        set.columns.length > 0 &&
        cellRange.c1 === 0 &&
        cellRange.c2 === set.columns.length - 1 &&
        row >= cellRange.r1 &&
        row <= cellRange.r2,
    );
  }

  function focusGrid() {
    bodyRef.current?.focus();
  }

  function onCellDown(row: number, col: number, event: ReactMouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    focusGrid();
    setMenu(null);
    pointer.current = { x: event.clientX, y: event.clientY };
    const current = selectionRef.current;
    if (event.shiftKey && current?.mode === "cells") {
      setSelection({ mode: "cells", anchor: current.anchor, focus: { row, col } });
    } else {
      setSelection({ mode: "cells", anchor: { row, col }, focus: { row, col } });
    }
    drag.current = "cells";
  }

  function onRowDown(row: number, event: ReactMouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    focusGrid();
    setMenu(null);
    pointer.current = { x: event.clientX, y: event.clientY };
    const current = selectionRef.current;
    if (event.shiftKey && current?.mode === "rows") {
      setSelection({ mode: "rows", anchor: current.anchor, rows: inclusive(current.anchor, row) });
    } else if (event.ctrlKey || event.metaKey) {
      const rows = current?.mode === "rows" ? current.rows : [];
      const next = rows.includes(row) ? rows.filter((item) => item !== row) : [...rows, row];
      setSelection({ mode: "rows", anchor: row, rows: next.length > 0 ? next : [row] });
      return;
    } else {
      setSelection({ mode: "rows", anchor: row, rows: [row] });
    }
    drag.current = "rows";
  }

  function onColumnDown(col: number, event: ReactMouseEvent) {
    if (event.button !== 0) return;
    event.preventDefault();
    focusGrid();
    setMenu(null);
    pointer.current = { x: event.clientX, y: event.clientY };
    const current = selectionRef.current;
    if (event.shiftKey && current?.mode === "columns") {
      setSelection({ mode: "columns", anchor: current.anchor, cols: inclusive(current.anchor, col) });
    } else if (event.ctrlKey || event.metaKey) {
      const cols = current?.mode === "columns" ? current.cols : [];
      const next = cols.includes(col) ? cols.filter((item) => item !== col) : [...cols, col];
      setSelection({ mode: "columns", anchor: col, cols: next.length > 0 ? next : [col] });
      return;
    } else {
      setSelection({ mode: "columns", anchor: col, cols: [col] });
    }
    drag.current = "columns";
  }

  function selectAll() {
    if (set.columns.length === 0) return;
    focusGrid();
    if (set.rows.length === 0) {
      setSelection({ mode: "columns", anchor: 0, cols: inclusive(0, set.columns.length - 1) });
      return;
    }
    setSelection({
      mode: "cells",
      anchor: { row: 0, col: 0 },
      focus: { row: set.rows.length - 1, col: set.columns.length - 1 },
    });
  }

  function openMenu(x: number, y: number) {
    setMenu({
      x: Math.max(8, Math.min(x, window.innerWidth - 248)),
      y: Math.max(8, Math.min(y, window.innerHeight - 140)),
    });
  }

  function onCellMenu(row: number, col: number, event: ReactMouseEvent) {
    event.preventDefault();
    focusGrid();
    if (!cellSelected(row, col)) setSelection({ mode: "cells", anchor: { row, col }, focus: { row, col } });
    openMenu(event.clientX, event.clientY);
  }

  function onRowMenu(row: number, event: ReactMouseEvent) {
    event.preventDefault();
    focusGrid();
    const current = selectionRef.current;
    if (!(current?.mode === "rows" && current.rows.includes(row))) {
      setSelection({ mode: "rows", anchor: row, rows: [row] });
    }
    openMenu(event.clientX, event.clientY);
  }

  function onColumnMenu(col: number, event: ReactMouseEvent) {
    event.preventDefault();
    focusGrid();
    const current = selectionRef.current;
    if (!(current?.mode === "columns" && current.cols.includes(col))) {
      setSelection({ mode: "columns", anchor: col, cols: [col] });
    }
    openMenu(event.clientX, event.clientY);
  }

  function reveal(row: number) {
    const body = bodyRef.current;
    if (!body) return;
    const top = row * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    if (top < body.scrollTop) body.scrollTop = top;
    else if (bottom > body.scrollTop + body.clientHeight) body.scrollTop = bottom - body.clientHeight;
  }

  function moveFocus(key: string, extend: boolean) {
    const rowCount = set.rows.length;
    const colCount = set.columns.length;
    if (rowCount === 0 || colCount === 0) return;
    const current = selectionRef.current;
    let row = 0;
    let col = 0;
    let anchor: CellPos = { row: 0, col: 0 };
    if (current?.mode === "cells") {
      row = current.focus.row;
      col = current.focus.col;
      anchor = current.anchor;
    } else if (current?.mode === "rows") {
      const last = current.rows[current.rows.length - 1] ?? current.anchor;
      row = last;
      anchor = { row: current.anchor, col: 0 };
    } else if (current?.mode === "columns") {
      const last = current.cols[current.cols.length - 1] ?? current.anchor;
      col = last;
      anchor = { row: 0, col: current.anchor };
    }
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    if (key === "ArrowUp") row -= 1;
    else if (key === "ArrowDown") row += 1;
    else if (key === "ArrowLeft") col -= 1;
    else if (key === "ArrowRight") col += 1;
    else if (key === "PageUp") row -= page;
    else if (key === "PageDown") row += page;
    else if (key === "Home") col = 0;
    else if (key === "End") col = colCount - 1;
    row = clamp(row, 0, rowCount - 1);
    col = clamp(col, 0, colCount - 1);
    const focus = { row, col };
    setSelection({ mode: "cells", anchor: extend ? anchor : focus, focus });
    reveal(row);
  }

  async function copySelection(withHeaders: boolean) {
    const current = selectionRef.current;
    if (!current) return;
    const picked = pickedCells(set, current);
    if (picked.cols.length === 0 || (picked.rows.length === 0 && !withHeaders)) return;
    const lines: string[] = [];
    if (withHeaders) lines.push(picked.cols.map((col) => formatCell(set.columns[col])).join("\t"));
    for (const row of picked.rows) lines.push(picked.cols.map((col) => formatCell(set.rows[row][col])).join("\t"));
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      const amount = picked.rows.length === 1 ? "1 row" : `${picked.rows.length} rows`;
      setNote(withHeaders ? `Copied ${amount} with headers` : `Copied ${amount}`);
      window.clearTimeout(noteTimer.current);
      noteTimer.current = window.setTimeout(() => setNote(""), 2200);
    } catch {
      setNote("Could not copy to the clipboard");
    }
    setMenu(null);
  }

  return (
    <div className="grid-block">
      {total > 1 ? (
        <div className="grid-caption">
          Result set {index + 1}
          {set.truncated ? " (truncated)" : ""}
        </div>
      ) : null}
      <div className="grid">
        <div className="grid-head" ref={headRef}>
          <div className="grid-row head" style={{ width }}>
            <div className="grid-gutter" title="Select all" onMouseDown={(event) => event.preventDefault()} onClick={selectAll} />
            {set.columns.map((column, columnIndex) => (
              <div
                key={`${column}-${columnIndex}`}
                className={`grid-cell ${headerSelected(columnIndex) ? "selected" : ""}`}
                style={{ width: widths[columnIndex] }}
                title={column}
                onMouseDown={(event) => onColumnDown(columnIndex, event)}
                onContextMenu={(event) => onColumnMenu(columnIndex, event)}
              >
                {column}
              </div>
            ))}
          </div>
        </div>
        <div
          className="grid-body"
          ref={bodyRef}
          tabIndex={0}
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop);
            if (headRef.current) headRef.current.scrollLeft = event.currentTarget.scrollLeft;
            setMenu(null);
          }}
          onKeyDown={(event) => {
            const key = event.key.toLowerCase();
            if ((event.ctrlKey || event.metaKey) && key === "a") {
              event.preventDefault();
              event.stopPropagation();
              selectAll();
              return;
            }
            if ((event.ctrlKey || event.metaKey) && key === "c") {
              event.preventDefault();
              event.stopPropagation();
              void copySelection(!event.shiftKey);
              return;
            }
            if (event.key === "Escape") {
              setMenu(null);
              return;
            }
            if (
              event.key === "ArrowUp" ||
              event.key === "ArrowDown" ||
              event.key === "ArrowLeft" ||
              event.key === "ArrowRight" ||
              event.key === "Home" ||
              event.key === "End" ||
              event.key === "PageUp" ||
              event.key === "PageDown"
            ) {
              event.preventDefault();
              event.stopPropagation();
              moveFocus(event.key, event.shiftKey);
            }
          }}
        >
          <div style={{ height: set.rows.length * ROW_HEIGHT, width, position: "relative" }}>
            <div style={{ position: "absolute", top: start * ROW_HEIGHT, left: 0, width }}>
              {visible.map((row, offset) => {
                const rowIndex = start + offset;
                const rowSelected = rowHeaderSelected(rowIndex);
                return (
                  <div key={rowIndex} className="grid-row" style={{ width }}>
                    <div
                      className={`grid-gutter ${rowSelected ? "selected" : ""}`}
                      title="Select row"
                      onMouseDown={(event) => onRowDown(rowIndex, event)}
                      onContextMenu={(event) => onRowMenu(rowIndex, event)}
                    >
                      {rowIndex + 1}
                    </div>
                    {row.map((value, columnIndex) => {
                      const selected = cellSelected(rowIndex, columnIndex);
                      const active =
                        selection?.mode === "cells" &&
                        selection.focus.row === rowIndex &&
                        selection.focus.col === columnIndex;
                      return (
                        <div
                          key={columnIndex}
                          className={`grid-cell ${value === null ? "null" : ""} ${selected ? "selected" : ""} ${active ? "active" : ""}`}
                          style={{ width: widths[columnIndex] }}
                          title={value ?? "NULL"}
                          onMouseDown={(event) => onCellDown(rowIndex, columnIndex, event)}
                          onContextMenu={(event) => onCellMenu(rowIndex, columnIndex, event)}
                        >
                          {value ?? "NULL"}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      <div className="affected">
        {affectedText(set.rowsAffected)}
        {note ? <span className="copy-note">{note}</span> : null}
      </div>
      {menu ? (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button type="button" disabled={!selection} onClick={() => void copySelection(true)}>
            <span className="menu-label"><span className="menu-ico"><CopyIcon /></span><span>Copy with Headers</span></span>
            <span className="hint">Ctrl+C</span>
          </button>
          <button type="button" disabled={!selection} onClick={() => void copySelection(false)}>
            <span className="menu-label"><span className="menu-ico"><CopyPlainIcon /></span><span>Copy without Headers</span></span>
            <span className="hint">Ctrl+Shift+C</span>
          </button>
          <div className="menu-sep" />
          <button type="button" onClick={() => { setMenu(null); selectAll(); }}>
            <span className="menu-label"><span className="menu-ico"><SelectAllIcon /></span><span>Select All</span></span>
            <span className="hint">Ctrl+A</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function affectedText(count: number): string {
  const noun = count === 1 ? "row" : "rows";
  return `(${count.toLocaleString()} ${noun} affected)`;
}

function pickedCells(set: ResultSet, selection: Selection): { rows: number[]; cols: number[] } {
  if (selection.mode === "cells") {
    return {
      rows: inclusive(selection.anchor.row, selection.focus.row),
      cols: inclusive(selection.anchor.col, selection.focus.col),
    };
  }
  if (selection.mode === "rows") {
    return {
      rows: [...selection.rows].sort((a, b) => a - b),
      cols: indexRange(set.columns.length),
    };
  }
  return {
    rows: indexRange(set.rows.length),
    cols: [...selection.cols].sort((a, b) => a - b),
  };
}

function hitBody(body: HTMLDivElement, clientX: number, clientY: number, widths: number[], rowCount: number) {
  const rect = body.getBoundingClientRect();
  const y = clientY - rect.top + body.scrollTop;
  const row = clamp(Math.floor(y / ROW_HEIGHT), 0, Math.max(0, rowCount - 1));
  const x = clientX - rect.left + body.scrollLeft - 46;
  if (x < 0) return { row, col: -1 };
  let used = 0;
  for (let index = 0; index < widths.length; index += 1) {
    used += widths[index];
    if (x < used) return { row, col: index };
  }
  return { row, col: Math.max(0, widths.length - 1) };
}

function indexRange(count: number): number[] {
  if (count <= 0) return [];
  return inclusive(0, count - 1);
}

function inclusive(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const values: number[] = [];
  for (let index = start; index <= end; index += 1) values.push(index);
  return values;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatCell(value: string | null): string {
  if (value === null) return "";
  if (/[\t\r\n"]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function measure(set: ResultSet): number[] {
  return set.columns.map((name, index) => {
    let width = Math.max(80, name.length * 8 + 28);
    for (const row of set.rows.slice(0, 40)) {
      const text = row[index] ?? "NULL";
      width = Math.max(width, Math.min(300, text.length * 7.2 + 22));
    }
    return Math.round(Math.min(340, width));
  });
}
