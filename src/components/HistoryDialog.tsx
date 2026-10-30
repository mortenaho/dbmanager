import { useEffect, useState } from "react";
import { deleteHistory, getHistory, listEvents, listHistory } from "../api";
import { engineLabel, errorText, type AppEvent, type EngineKind, type HistoryDetail, type HistoryQuery } from "../types";
import { ClearIcon, DeleteIcon, LogIcon, NewQueryIcon, OptionsIcon, ResultsIcon } from "./Icons";
import { ResultsPane } from "./ResultsPane";

type Props = {
  version: number;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenQuery: (database: string, sql: string) => void;
  onExport: (format: "xlsx" | "json", detail: HistoryDetail) => void;
  onClear: () => void;
};

export function HistoryDialog({ version, onClose, onOpenSettings, onOpenQuery, onExport, onClear }: Props) {
  const [tab, setTab] = useState<"queries" | "log">("queries");
  const [filter, setFilter] = useState("");
  const [queries, setQueries] = useState<HistoryQuery[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [error, setError] = useState("");
  const [pane, setPane] = useState<"results" | "messages">("results");

  useEffect(() => {
    let cancel = false;
    const handle = window.setTimeout(() => {
      const request = tab === "queries" ? listHistory(filter) : listEvents(filter);
      request
        .then((rows) => {
          if (cancel) return;
          setError("");
          if (tab === "queries") {
            const items = rows as HistoryQuery[];
            setQueries(items);
            setSelectedId((current) =>
              current != null && items.some((item) => item.id === current) ? current : (items[0]?.id ?? null),
            );
          } else {
            setEvents(rows as AppEvent[]);
          }
        })
        .catch((reason) => {
          if (!cancel) setError(errorText(reason));
        });
    }, 200);
    return () => {
      cancel = true;
      window.clearTimeout(handle);
    };
  }, [tab, filter, version]);

  useEffect(() => {
    if (tab !== "queries" || selectedId == null) {
      setDetail(null);
      return;
    }
    let cancel = false;
    getHistory(selectedId)
      .then((item) => {
        if (cancel) return;
        setDetail(item);
        setPane(item.status === "error" || item.status === "blocked" ? "messages" : "results");
      })
      .catch((reason) => {
        if (!cancel) setError(errorText(reason));
      });
    return () => {
      cancel = true;
    };
  }, [tab, selectedId]);

  async function removeSelected() {
    if (selectedId == null) return;
    try {
      await deleteHistory(selectedId);
      setQueries((current) => current.filter((item) => item.id !== selectedId));
      setSelectedId(null);
      setDetail(null);
    } catch (reason) {
      setError(errorText(reason));
    }
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="dialog history" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog-title">History</div>
        <div className="history-body">
          <div className="history-toolbar">
            <button type="button" className={tab === "queries" ? "active" : ""} onClick={() => setTab("queries")}>
              <ResultsIcon />
              Queries
            </button>
            <button type="button" className={tab === "log" ? "active" : ""} onClick={() => setTab("log")}>
              <LogIcon />
              Log
            </button>
            <button type="button" onClick={onOpenSettings}>
              <OptionsIcon />
              Options
            </button>
            <input
              value={filter}
              placeholder="Filter"
              aria-label="Filter history"
              onChange={(event) => setFilter(event.target.value)}
            />
          </div>
          {error ? <div className="dialog-error history-error">{error}</div> : null}
          {tab === "log" ? (
            <div className="history-list">
              {events.length === 0 ? <div className="empty-results">No log entries.</div> : null}
              <table className="history-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Kind</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className={event.level === "error" ? "bad" : ""}>
                      <td>{formatWhen(event.createdAt)}</td>
                      <td>{event.kind}</td>
                      <td>{event.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <>
              <div className="history-list">
                {queries.length === 0 ? <div className="empty-results">No queries have been saved yet.</div> : null}
                <table className="history-table pick">
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Server</th>
                      <th>Database</th>
                      <th>Rows</th>
                      <th>SQL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map((item) => (
                      <tr
                        key={item.id}
                        className={`${item.id === selectedId ? "selected" : ""} ${item.status === "error" || item.status === "blocked" ? "bad" : ""}`}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <td>{formatWhen(item.createdAt)}</td>
                        <td>
                          {engineLabel(item.engine as EngineKind)} {item.server}
                        </td>
                        <td>{item.databaseName}</td>
                        <td>{item.rowCount.toLocaleString()}</td>
                        <td>{preview(item.sql)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="history-detail">
                {detail ? (
                  <>
                    <pre className="history-sql">{detail.sql}</pre>
                    <div className="history-results">
                      <ResultsPane
                        resultSets={detail.resultSets}
                        messages={detail.messages}
                        activePane={pane}
                        onPane={setPane}
                        onExport={(format) => onExport(format, detail)}
                      />
                    </div>
                  </>
                ) : (
                  <div className="empty-results">Select a query to see its SQL and cached results.</div>
                )}
              </div>
            </>
          )}
        </div>
        <div className="dialog-actions">
          <button type="button" disabled={!detail} onClick={() => detail && onOpenQuery(detail.databaseName, detail.sql)}>
            <NewQueryIcon />
            Open in new query
          </button>
          <button type="button" disabled={selectedId == null || tab !== "queries"} onClick={() => void removeSelected()}>
            <DeleteIcon />
            Delete
          </button>
          <button type="button" onClick={onClear}>
            <ClearIcon />
            Clear history
          </button>
          <span className="spacer" />
          <button className="default" type="button" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function preview(sql: string): string {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 137)}...` : line;
}
