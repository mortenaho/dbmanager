import { useEffect, useState } from "react";
import { deleteHistory, getHistory, listEvents, listHistory } from "../api";
import {
  engineLabel,
  errorText,
  type AppEvent,
  type EngineKind,
  type HistoryDetail,
  type HistoryQuery,
  type ResultSet,
} from "../types";
import { ClearIcon, DeleteIcon, LogIcon, NewQueryIcon, OptionsIcon, ResultsIcon } from "./Icons";
import { ResultsPane } from "./ResultsPane";

type Props = {
  version: number;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenQuery: (database: string, sql: string) => void;
  onExport: (format: "xlsx" | "json", detail: HistoryDetail) => void;
  onClear: () => void;
  onRollback: (detail: HistoryDetail) => Promise<void>;
};

export function HistoryDialog({ version, onClose, onOpenSettings, onOpenQuery, onExport, onClear, onRollback }: Props) {
  const [tab, setTab] = useState<"queries" | "log">("queries");
  const [filter, setFilter] = useState("");
  const [queries, setQueries] = useState<HistoryQuery[]>([]);
  const [events, setEvents] = useState<AppEvent[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<HistoryDetail | null>(null);
  const [error, setError] = useState("");
  const [pane, setPane] = useState<"results" | "messages">("results");
  const [rolling, setRolling] = useState(false);
  const [view, setView] = useState<"results" | "changes">("results");

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
  }, [tab, selectedId, version]);

  const canRollback = detail?.backups.some((backup) => !backup.rolledBack) ?? false;

  async function rollback() {
    if (!detail || !canRollback) return;
    setRolling(true);
    setError("");
    try {
      await onRollback(detail);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setRolling(false);
    }
  }

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
              placeholder="Search SQL, database, or server"
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
                      <th>Database</th>
                      <th>Status</th>
                      <th>Rows</th>
                      <th>Backup</th>
                      <th>SQL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queries.map((item) => (
                      <tr
                        key={item.id}
                        className={`${item.id === selectedId ? "selected" : ""} ${item.status === "error" || item.status === "blocked" ? "bad" : ""}`}
                        onClick={() => {
                          setSelectedId(item.id);
                          if (item.backupRows <= 0) setView("results");
                        }}
                      >
                        <td className="history-when">{formatWhen(item.createdAt)}</td>
                        <td>
                          <div>{item.databaseName || "—"}</div>
                          <div className="history-sub">
                            {engineLabel(item.engine as EngineKind)} {item.server}
                          </div>
                        </td>
                        <td>{statusBadge(item.status)}</td>
                        <td>{item.rowCount.toLocaleString()}</td>
                        <td>
                          <div className="history-backup-cell">
                            {backupBadge(item)}
                            {item.backupRows > 0 ? (
                              <button
                                type="button"
                                className={`history-mini${item.id === selectedId && view === "changes" ? " active" : ""}`}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedId(item.id);
                                  setView("changes");
                                }}
                              >
                                Details
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="history-sql-cell" title={item.sql}>
                          {preview(item.sql)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="history-detail">
                {detail ? (
                  <>
                    <div className="history-detail-head">
                      <div className="history-detail-meta">
                        {statusBadge(detail.status)}
                        <span>{formatWhen(detail.createdAt)}</span>
                        <span>{detail.databaseName || "No database"}</span>
                        <span>{detail.rowCount.toLocaleString()} affected</span>
                        <span>{detail.elapsedMs.toLocaleString()} ms</span>
                      </div>
                      <pre className="history-sql">{detail.sql}</pre>
                      <div className="history-switch">
                        <button type="button" className={view === "results" ? "active" : ""} onClick={() => setView("results")}>
                          Results
                        </button>
                        <button
                          type="button"
                          className={view === "changes" ? "active" : ""}
                          disabled={detail.backups.length === 0}
                          onClick={() => setView("changes")}
                        >
                          Changed rows
                          {detail.backups.length > 0 ? ` (${changedCount(detail).toLocaleString()})` : ""}
                        </button>
                        {detail.backups.length > 0 ? (
                          <button type="button" className="history-rollback" disabled={!canRollback || rolling} onClick={() => void rollback()}>
                            {rolling ? "Rolling back..." : canRollback ? "Roll back" : "Rolled back"}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <div className="history-results">
                      {view === "changes" ? (
                        detail.backups.length === 0 ? (
                          <div className="empty-results">This query has no saved rows. Only UPDATE and DELETE keep a before-image.</div>
                        ) : (
                          <div className="history-changes">
                            <div className="history-change-cards">
                              {detail.backups.map((backup, index) => (
                                <div key={index} className={`history-change-card ${backup.kind === "delete" ? "delete" : "update"}`}>
                                  <span className={backup.kind === "delete" ? "history-badge error" : "history-badge blocked"}>
                                    {backup.kind === "delete" ? "Deleted" : "Updated"}
                                  </span>
                                  <strong>{backup.tableName}</strong>
                                  <span>{backup.rowCount === 1 ? "1 row" : `${backup.rowCount.toLocaleString()} rows`}</span>
                                  <span className={backup.rolledBack ? "history-badge done" : "history-badge"}>
                                    {backup.rolledBack ? "Rolled back" : "Before image"}
                                  </span>
                                </div>
                              ))}
                            </div>
                            <p className="history-change-note">
                              Deleted cards are the rows that were removed. Updated cards are the values from before the statement ran.
                            </p>
                            <ResultsPane
                              resultSets={changeSets(detail)}
                              captions={changeCaptions(detail)}
                              messages={[]}
                              activePane="results"
                              onPane={() => undefined}
                              onExport={(format) => onExport(format, { ...detail, resultSets: changeSets(detail) })}
                            />
                          </div>
                        )
                      ) : (
                        <ResultsPane
                          resultSets={detail.resultSets}
                          messages={detail.messages}
                          activePane={pane}
                          onPane={setPane}
                          onExport={(format) => onExport(format, detail)}
                        />
                      )}
                    </div>
                  </>
                ) : (
                  <div className="empty-results">Select a query to see its SQL, results, and any saved rows.</div>
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

function changeSets(detail: HistoryDetail): ResultSet[] {
  return detail.backups.map((backup) => ({
    columns: backup.columns,
    rows: backup.rows,
    rowsAffected: backup.rows.length,
    truncated: false,
  }));
}

function changeCaptions(detail: HistoryDetail): string[] {
  return detail.backups.map((backup) => {
    const action = backup.kind === "delete" ? "Deleted from" : "Updated in";
    const rows = backup.rowCount === 1 ? "1 row" : `${backup.rowCount.toLocaleString()} rows`;
    const state = backup.rolledBack ? ", already rolled back" : "";
    return `${action} ${backup.tableName} — ${rows}${state}`;
  });
}

function statusBadge(status: string) {
  if (status === "error") return <span className="history-badge error">Error</span>;
  if (status === "blocked") return <span className="history-badge blocked">Blocked</span>;
  return <span className="history-badge ok">OK</span>;
}

function backupBadge(item: HistoryQuery) {
  if (item.backupRows <= 0) return <span className="history-muted">—</span>;
  if (item.rollbackCount > 0) return <span className="history-badge">Backed up</span>;
  return <span className="history-badge done">Rolled back</span>;
}

function changedCount(detail: HistoryDetail): number {
  return detail.backups.reduce((sum, backup) => sum + backup.rowCount, 0);
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
