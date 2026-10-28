import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { QueryMessage, ResultSet } from "../types";

type Props = {
  resultSets: ResultSet[];
  messages: QueryMessage[];
  activePane: "results" | "messages";
  onPane: (pane: "results" | "messages") => void;
};

const ROW_HEIGHT = 22;

export function ResultsPane({ resultSets, messages, activePane, onPane }: Props) {
  const grids = resultSets.filter((set) => set.columns.length > 0);
  const hasError = messages.some((message) => message.level === "error");

  return (
    <div className="results">
      <div className="result-tabs">
        <button className={activePane === "results" ? "active" : ""} onClick={() => onPane("results")}>
          Results
        </button>
        <button
          className={`${activePane === "messages" ? "active" : ""} ${hasError ? "has-error" : ""}`}
          onClick={() => onPane("messages")}
        >
          Messages
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
          <div className="empty-results">The statement did not return a result set. See Messages for details.</div>
        ) : (
          grids.map((set, index) => <ResultGrid key={index} set={set} index={index} total={grids.length} />)
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
  const [selected, setSelected] = useState<number[]>([]);
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const anchor = useRef(0);

  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setViewport(node.clientHeight));
    observer.observe(node);
    setViewport(node.clientHeight);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - 4);
  const count = Math.ceil(viewport / ROW_HEIGHT) + 8;
  const visible = set.rows.slice(start, start + count);

  function choose(rowIndex: number, column: number, event: MouseEvent) {
    if (event.shiftKey) {
      const from = Math.min(anchor.current, rowIndex);
      const to = Math.max(anchor.current, rowIndex);
      setSelected(Array.from({ length: to - from + 1 }, (_, offset) => from + offset));
    } else if (event.ctrlKey || event.metaKey) {
      setSelected((current) =>
        current.includes(rowIndex) ? current.filter((item) => item !== rowIndex) : [...current, rowIndex],
      );
      anchor.current = rowIndex;
    } else {
      setSelected([rowIndex]);
      anchor.current = rowIndex;
    }
    setActiveCell({ row: rowIndex, col: column });
  }

  async function copySelection() {
    if (selected.length === 0) return;
    const lines = [...selected]
      .sort((a, b) => a - b)
      .map((rowIndex) => set.rows[rowIndex].map((value) => value ?? "NULL").join("\t"));
    const header = set.columns.join("\t");
    await navigator.clipboard.writeText(`${header}\n${lines.join("\n")}`);
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
            <div className="grid-gutter" />
            {set.columns.map((column, columnIndex) => (
              <div key={`${column}-${columnIndex}`} className="grid-cell" style={{ width: widths[columnIndex] }} title={column}>
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
          }}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c") {
              event.preventDefault();
              void copySelection();
            }
          }}
        >
          <div style={{ height: set.rows.length * ROW_HEIGHT, width, position: "relative" }}>
            <div style={{ position: "absolute", top: start * ROW_HEIGHT, left: 0, width }}>
              {visible.map((row, offset) => {
                const rowIndex = start + offset;
                const isSelected = selected.includes(rowIndex);
                return (
                  <div key={rowIndex} className={`grid-row ${isSelected ? "selected" : ""}`} style={{ width }}>
                    <div className="grid-gutter">{rowIndex + 1}</div>
                    {row.map((value, columnIndex) => {
                      const active = activeCell?.row === rowIndex && activeCell.col === columnIndex;
                      return (
                        <div
                          key={columnIndex}
                          className={`grid-cell ${value === null ? "null" : ""} ${active ? "active" : ""}`}
                          style={{ width: widths[columnIndex] }}
                          title={value ?? "NULL"}
                          onMouseDown={(event) => choose(rowIndex, columnIndex, event)}
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
      <div className="affected">({set.rowsAffected.toLocaleString()} rows affected)</div>
    </div>
  );
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
