use std::path::Path;
use std::sync::Mutex;

use chrono::{Duration, SecondsFormat, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use tauri::{AppHandle, Manager};

use crate::model::{EngineKind, QueryMessage, ResultSet};

const MAX_CACHED_ROWS: usize = 2_000;

pub struct HistoryDb(pub Mutex<Connection>);

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub history_days: u32,
    pub ai_base_url: String,
    pub ai_model: String,
    pub ai_api_key: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryQuery {
    pub id: i64,
    pub created_at: String,
    pub engine: String,
    pub server: String,
    pub database_name: String,
    pub sql: String,
    pub status: String,
    pub error: String,
    pub elapsed_ms: i64,
    pub row_count: i64,
    pub backup_rows: i64,
    pub rollback_count: i64,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetail {
    #[serde(flatten)]
    pub query: HistoryQuery,
    pub messages: Vec<QueryMessage>,
    pub result_sets: Vec<ResultSet>,
    pub backups: Vec<BackupInfo>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub statement_index: i64,
    pub kind: String,
    pub table_name: String,
    pub row_count: i64,
    pub rolled_back: bool,
}

#[derive(Debug, Clone)]
pub struct NewBackup {
    pub statement_index: i64,
    pub kind: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub key_columns: Vec<String>,
    pub write_columns: Vec<String>,
    pub identity_insert: bool,
    pub overriding_system: bool,
}

#[derive(Debug, Clone)]
pub struct LoadedBackup {
    pub kind: String,
    pub table_name: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub key_columns: Vec<String>,
    pub write_columns: Vec<String>,
    pub identity_insert: bool,
    pub overriding_system: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppEvent {
    pub id: i64,
    pub created_at: String,
    pub level: String,
    pub kind: String,
    pub message: String,
}

pub struct QueryRecord<'a> {
    pub engine: EngineKind,
    pub server: &'a str,
    pub database: &'a str,
    pub sql: &'a str,
    pub elapsed_ms: u128,
    pub status: &'a str,
    pub error: &'a str,
    pub messages: &'a [QueryMessage],
    pub sets: &'a [ResultSet],
}

impl HistoryDb {
    pub fn with_conn<T>(
        &self,
        f: impl FnOnce(&Connection) -> Result<T, String>,
    ) -> Result<T, String> {
        let conn = self.0.lock().map_err(|e| e.to_string())?;
        f(&conn)
    }

    pub fn note(&self, level: &str, kind: &str, message: &str) {
        if let Err(error) = self.with_conn(|conn| log_event(conn, level, kind, message)) {
            eprintln!("history: {error}");
        }
    }

    pub fn remember(&self, record: QueryRecord<'_>) {
        self.remember_with(record, &[]);
    }

    pub fn remember_with(&self, record: QueryRecord<'_>, backups: &[NewBackup]) {
        if let Err(error) = self.with_conn(|conn| record_query(conn, record, backups)) {
            eprintln!("history: {error}");
        }
    }
}

pub fn open_app(app: &AppHandle) -> Result<HistoryDb, Box<dyn std::error::Error>> {
    let dir = app.path().app_config_dir()?;
    let conn = open_file(&dir.join("history.db"))
        .map_err(|message| std::io::Error::new(std::io::ErrorKind::Other, message))?;
    Ok(HistoryDb(Mutex::new(conn)))
}

pub fn open_file(path: &Path) -> Result<Connection, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(2))
        .map_err(|e| e.to_string())?;
    migrate(&conn)?;
    let days = load_settings(&conn)?.history_days;
    purge(&conn, days)?;
    Ok(conn)
}

fn migrate(conn: &Connection) -> Result<(), String> {
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
         );
         INSERT INTO settings(key, value) VALUES ('history_days', '30')
            ON CONFLICT(key) DO NOTHING;
         CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            level TEXT NOT NULL,
            kind TEXT NOT NULL,
            message TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS events_created ON events(created_at DESC);
         CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            engine TEXT NOT NULL,
            server TEXT NOT NULL,
            database_name TEXT NOT NULL,
            sql TEXT NOT NULL,
            status TEXT NOT NULL,
            error TEXT NOT NULL,
            elapsed_ms INTEGER NOT NULL,
            row_count INTEGER NOT NULL,
            messages_json TEXT NOT NULL
         );
         CREATE INDEX IF NOT EXISTS queries_created ON queries(created_at DESC);
         CREATE TABLE IF NOT EXISTS query_sets (
            query_id INTEGER NOT NULL,
            set_index INTEGER NOT NULL,
            columns_json TEXT NOT NULL,
            rows_json TEXT NOT NULL,
            rows_affected INTEGER NOT NULL,
            truncated INTEGER NOT NULL,
            PRIMARY KEY (query_id, set_index),
            FOREIGN KEY (query_id) REFERENCES queries(id) ON DELETE CASCADE
         );
         CREATE TABLE IF NOT EXISTS snapshots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            query_id INTEGER NOT NULL,
            statement_index INTEGER NOT NULL,
            kind TEXT NOT NULL,
            table_name TEXT NOT NULL,
            columns_json TEXT NOT NULL,
            rows_json TEXT NOT NULL,
            key_columns_json TEXT NOT NULL,
            write_columns_json TEXT NOT NULL,
            identity_insert INTEGER NOT NULL,
            overriding_system INTEGER NOT NULL,
            row_count INTEGER NOT NULL,
            rolled_back INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (query_id) REFERENCES queries(id) ON DELETE CASCADE
         );
         CREATE INDEX IF NOT EXISTS snapshots_query ON snapshots(query_id);",
    )
    .map_err(|e| e.to_string())
}

fn setting_text(conn: &Connection, key: &str) -> Result<String, String> {
    let value: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    Ok(value.unwrap_or_default())
}

fn put_setting(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO settings(key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn load_settings(conn: &Connection) -> Result<AppSettings, String> {
    let days = setting_text(conn, "history_days")?
        .parse()
        .ok()
        .unwrap_or(30);
    Ok(AppSettings {
        history_days: normalize_days(days),
        ai_base_url: setting_text(conn, "ai_base_url")?,
        ai_model: setting_text(conn, "ai_model")?,
        ai_api_key: setting_text(conn, "ai_api_key")?,
    })
}

pub fn save_settings(conn: &Connection, days: u32) -> Result<AppSettings, String> {
    let days = normalize_days(days);
    put_setting(conn, "history_days", &days.to_string())?;
    purge(conn, days)?;
    load_settings(conn)
}

pub fn save_assistant(
    conn: &Connection,
    base_url: &str,
    model: &str,
    api_key: &str,
) -> Result<AppSettings, String> {
    put_setting(conn, "ai_base_url", base_url.trim())?;
    put_setting(conn, "ai_model", model.trim())?;
    put_setting(conn, "ai_api_key", api_key.trim())?;
    load_settings(conn)
}

pub fn normalize_days(days: u32) -> u32 {
    match days {
        0 | 1 | 7 | 30 | 90 | 365 => days,
        _ => 30,
    }
}

pub fn purge(conn: &Connection, days: u32) -> Result<(), String> {
    if days == 0 {
        return Ok(());
    }
    let cutoff =
        (Utc::now() - Duration::days(days as i64)).to_rfc3339_opts(SecondsFormat::Millis, true);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM snapshots WHERE query_id IN (SELECT id FROM queries WHERE created_at < ?1)",
        params![cutoff],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM queries WHERE created_at < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM events WHERE created_at < ?1", params![cutoff])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn log_event(conn: &Connection, level: &str, kind: &str, message: &str) -> Result<(), String> {
    let level = match level {
        "error" | "warn" => level,
        _ => "info",
    };
    let kind = kind.trim();
    let kind = if kind.is_empty() { "app" } else { kind };
    conn.execute(
        "INSERT INTO events(created_at, level, kind, message) VALUES (?1, ?2, ?3, ?4)",
        params![now(), level, kind, message.trim()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_events(conn: &Connection, needle: &str, limit: i64) -> Result<Vec<AppEvent>, String> {
    let limit = limit.clamp(1, 500);
    let needle = needle.trim();
    let sql = if needle.is_empty() {
        "SELECT id, created_at, level, kind, message FROM events ORDER BY id DESC LIMIT ?1"
    } else {
        "SELECT id, created_at, level, kind, message FROM events
         WHERE message LIKE ?1 ESCAPE '\\' OR kind LIKE ?1 ESCAPE '\\'
         ORDER BY id DESC LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = if needle.is_empty() {
        stmt.query(params![limit]).map_err(|e| e.to_string())?
    } else {
        stmt.query(params![like(needle), limit])
            .map_err(|e| e.to_string())?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        items.push(AppEvent {
            id: row.get(0).map_err(|e| e.to_string())?,
            created_at: row.get(1).map_err(|e| e.to_string())?,
            level: row.get(2).map_err(|e| e.to_string())?,
            kind: row.get(3).map_err(|e| e.to_string())?,
            message: row.get(4).map_err(|e| e.to_string())?,
        });
    }
    Ok(items)
}

pub fn record_query(
    conn: &Connection,
    record: QueryRecord<'_>,
    backups: &[NewBackup],
) -> Result<i64, String> {
    let (sets, notes) = cache_sets(record.sets);
    let mut messages = record.messages.to_vec();
    for note in notes {
        messages.push(QueryMessage::info(note));
    }
    let messages_json = serde_json::to_string(&messages).map_err(|e| e.to_string())?;
    let row_count: i64 = record.sets.iter().map(|set| set.rows.len() as i64).sum();
    let elapsed = i64::try_from(record.elapsed_ms).unwrap_or(i64::MAX);
    let preview = sql_preview(record.sql);
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO queries(created_at, engine, server, database_name, sql, status, error, elapsed_ms, row_count, messages_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            now(),
            engine_label(record.engine),
            record.server,
            record.database,
            record.sql,
            record.status,
            record.error,
            elapsed,
            row_count,
            messages_json
        ],
    )
    .map_err(|e| e.to_string())?;
    let id = tx.last_insert_rowid();
    for (index, set) in sets.iter().enumerate() {
        tx.execute(
            "INSERT INTO query_sets(query_id, set_index, columns_json, rows_json, rows_affected, truncated)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                index as i64,
                set.columns_json,
                set.rows_json,
                set.rows_affected as i64,
                if set.truncated { 1 } else { 0 }
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    for backup in backups {
        let columns_json = serde_json::to_string(&backup.columns).map_err(|e| e.to_string())?;
        let rows_json = serde_json::to_string(&backup.rows).map_err(|e| e.to_string())?;
        let key_columns_json =
            serde_json::to_string(&backup.key_columns).map_err(|e| e.to_string())?;
        let write_columns_json =
            serde_json::to_string(&backup.write_columns).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO snapshots(
                query_id, statement_index, kind, table_name, columns_json, rows_json,
                key_columns_json, write_columns_json, identity_insert, overriding_system, row_count, rolled_back
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0)",
            params![
                id,
                backup.statement_index,
                backup.kind,
                backup.table_name,
                columns_json,
                rows_json,
                key_columns_json,
                write_columns_json,
                if backup.identity_insert { 1 } else { 0 },
                if backup.overriding_system { 1 } else { 0 },
                backup.rows.len() as i64
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let level = if record.status == "error" {
        "error"
    } else {
        "info"
    };
    tx.execute(
        "INSERT INTO events(created_at, level, kind, message) VALUES (?1, ?2, 'query', ?3)",
        params![
            now(),
            level,
            format!(
                "{} {} — {} ({} rows, {} ms)",
                if record.status == "error" {
                    "Failed"
                } else {
                    "Ran"
                },
                record.database,
                preview,
                row_count,
                elapsed
            )
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

pub fn list_queries(
    conn: &Connection,
    needle: &str,
    limit: i64,
) -> Result<Vec<HistoryQuery>, String> {
    let limit = limit.clamp(1, 500);
    let needle = needle.trim();
    let sql = if needle.is_empty() {
        "SELECT id, created_at, engine, server, database_name, sql, status, error, elapsed_ms, row_count,
                COALESCE((SELECT SUM(row_count) FROM snapshots s WHERE s.query_id = queries.id), 0),
                COALESCE((SELECT COUNT(*) FROM snapshots s WHERE s.query_id = queries.id AND s.rolled_back = 0), 0)
         FROM queries ORDER BY id DESC LIMIT ?1"
    } else {
        "SELECT id, created_at, engine, server, database_name, sql, status, error, elapsed_ms, row_count,
                COALESCE((SELECT SUM(row_count) FROM snapshots s WHERE s.query_id = queries.id), 0),
                COALESCE((SELECT COUNT(*) FROM snapshots s WHERE s.query_id = queries.id AND s.rolled_back = 0), 0)
         FROM queries
         WHERE sql LIKE ?1 ESCAPE '\\' OR database_name LIKE ?1 ESCAPE '\\'
            OR server LIKE ?1 ESCAPE '\\' OR error LIKE ?1 ESCAPE '\\'
         ORDER BY id DESC LIMIT ?2"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let mut rows = if needle.is_empty() {
        stmt.query(params![limit]).map_err(|e| e.to_string())?
    } else {
        stmt.query(params![like(needle), limit])
            .map_err(|e| e.to_string())?
    };
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        items.push(map_query(row).map_err(|e| e.to_string())?);
    }
    Ok(items)
}

pub fn get_query(conn: &Connection, id: i64) -> Result<HistoryDetail, String> {
    let query = conn
        .query_row(
            "SELECT id, created_at, engine, server, database_name, sql, status, error, elapsed_ms, row_count,
                    COALESCE((SELECT SUM(row_count) FROM snapshots s WHERE s.query_id = queries.id), 0),
                    COALESCE((SELECT COUNT(*) FROM snapshots s WHERE s.query_id = queries.id AND s.rolled_back = 0), 0),
                    messages_json
             FROM queries WHERE id = ?1",
            params![id],
            |row| {
                let messages_json: String = row.get(12)?;
                Ok((map_query(row)?, messages_json))
            },
        )
        .map_err(|_| "This history entry was not found.".to_string())?;
    let messages = serde_json::from_str(&query.1).unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "SELECT columns_json, rows_json, rows_affected, truncated
             FROM query_sets WHERE query_id = ?1 ORDER BY set_index",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    let mut result_sets = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let columns: Vec<String> =
            serde_json::from_str(&row.get::<_, String>(0).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let values: Vec<Vec<Option<String>>> =
            serde_json::from_str(&row.get::<_, String>(1).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let affected: i64 = row.get(2).map_err(|e| e.to_string())?;
        let truncated: i64 = row.get(3).map_err(|e| e.to_string())?;
        result_sets.push(ResultSet {
            columns,
            rows: values,
            rows_affected: affected.max(0) as u64,
            truncated: truncated != 0,
        });
    }
    Ok(HistoryDetail {
        query: query.0,
        messages,
        result_sets,
        backups: backup_info(conn, id)?,
    })
}

pub fn backup_info(conn: &Connection, id: i64) -> Result<Vec<BackupInfo>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT statement_index, kind, table_name, row_count, rolled_back
             FROM snapshots WHERE query_id = ?1 ORDER BY statement_index",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let rolled: i64 = row.get(4).map_err(|e| e.to_string())?;
        items.push(BackupInfo {
            statement_index: row.get(0).map_err(|e| e.to_string())?,
            kind: row.get(1).map_err(|e| e.to_string())?,
            table_name: row.get(2).map_err(|e| e.to_string())?,
            row_count: row.get(3).map_err(|e| e.to_string())?,
            rolled_back: rolled != 0,
        });
    }
    Ok(items)
}

pub fn load_pending_backups(conn: &Connection, id: i64) -> Result<Vec<LoadedBackup>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT kind, table_name, columns_json, rows_json, key_columns_json, write_columns_json,
                    identity_insert, overriding_system
             FROM snapshots
             WHERE query_id = ?1 AND rolled_back = 0
             ORDER BY statement_index DESC",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![id]).map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let identity: i64 = row.get(6).map_err(|e| e.to_string())?;
        let overriding: i64 = row.get(7).map_err(|e| e.to_string())?;
        items.push(LoadedBackup {
            kind: row.get(0).map_err(|e| e.to_string())?,
            table_name: row.get(1).map_err(|e| e.to_string())?,
            columns: serde_json::from_str(&row.get::<_, String>(2).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
            rows: serde_json::from_str(&row.get::<_, String>(3).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
            key_columns: serde_json::from_str(&row.get::<_, String>(4).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?,
            write_columns: serde_json::from_str(
                &row.get::<_, String>(5).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?,
            identity_insert: identity != 0,
            overriding_system: overriding != 0,
        });
    }
    Ok(items)
}

pub fn mark_rolled_back(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute(
        "UPDATE snapshots SET rolled_back = 1 WHERE query_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_query(conn: &Connection, id: i64) -> Result<(), String> {
    conn.execute("DELETE FROM queries WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn clear_all(conn: &Connection) -> Result<(), String> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM snapshots", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM queries", [])
        .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM events", [])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

pub fn engine_label(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Mssql => "mssql",
        EngineKind::Postgres => "postgres",
        EngineKind::Mysql => "mysql",
    }
}

struct CachedSet {
    columns_json: String,
    rows_json: String,
    rows_affected: u64,
    truncated: bool,
}

fn cache_sets(sets: &[ResultSet]) -> (Vec<CachedSet>, Vec<String>) {
    let mut notes = Vec::new();
    let cached = sets
        .iter()
        .enumerate()
        .map(|(index, set)| {
            let mut rows = set.rows.clone();
            let mut truncated = set.truncated;
            if rows.len() > MAX_CACHED_ROWS {
                let total = rows.len();
                rows.truncate(MAX_CACHED_ROWS);
                truncated = true;
                notes.push(format!(
                    "Result set {} kept the first {MAX_CACHED_ROWS} of {total} rows in history.",
                    index + 1
                ));
            }
            CachedSet {
                columns_json: serde_json::to_string(&set.columns).unwrap_or_else(|_| "[]".into()),
                rows_json: serde_json::to_string(&rows).unwrap_or_else(|_| "[]".into()),
                rows_affected: set.rows_affected,
                truncated,
            }
        })
        .collect();
    (cached, notes)
}

fn map_query(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryQuery> {
    Ok(HistoryQuery {
        id: row.get(0)?,
        created_at: row.get(1)?,
        engine: row.get(2)?,
        server: row.get(3)?,
        database_name: row.get(4)?,
        sql: row.get(5)?,
        status: row.get(6)?,
        error: row.get(7)?,
        elapsed_ms: row.get(8)?,
        row_count: row.get(9)?,
        backup_rows: row.get(10)?,
        rollback_count: row.get(11)?,
    })
}

fn now() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn like(needle: &str) -> String {
    let escaped = needle
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    format!("%{escaped}%")
}

fn sql_preview(sql: &str) -> String {
    let line = sql.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() > 160 {
        format!("{}...", line.chars().take(157).collect::<String>())
    } else {
        line
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::QueryMessage;

    fn creds_sql() -> &'static str {
        "select id from orders"
    }

    fn sample<'a>(sets: &'a [ResultSet], messages: &'a [QueryMessage]) -> QueryRecord<'a> {
        QueryRecord {
            engine: EngineKind::Postgres,
            server: "localhost:5432",
            database: "appdb",
            sql: creds_sql(),
            elapsed_ms: 12,
            status: "ok",
            error: "",
            messages,
            sets,
        }
    }

    #[test]
    fn stores_query_output_without_passwords() {
        let path =
            std::env::temp_dir().join(format!("dbmanager-history-{}.db", uuid::Uuid::new_v4()));
        let conn = open_file(&path).unwrap();
        let sets = vec![ResultSet {
            columns: vec!["id".into(), "name".into()],
            rows: vec![
                vec![Some("1".into()), Some("Ada".into())],
                vec![Some("2".into()), None],
            ],
            rows_affected: 2,
            truncated: false,
        }];
        let messages = vec![QueryMessage::info("done")];
        let id = record_query(&conn, sample(&sets, &messages), &[]).unwrap();
        let listed = list_queries(&conn, "orders", 20).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].row_count, 2);
        let detail = get_query(&conn, id).unwrap();
        assert_eq!(detail.result_sets[0].rows[1][1], None);
        assert_eq!(detail.messages[0].text, "done");
        let events = list_events(&conn, "orders", 20).unwrap();
        assert_eq!(events.len(), 1);
        let columns = conn
            .prepare("PRAGMA table_info(queries)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(columns.iter().all(|name| !name.contains("password")));
        delete_query(&conn, id).unwrap();
        assert!(get_query(&conn, id).is_err());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn retention_deletes_old_history_and_keeps_forever() {
        let path =
            std::env::temp_dir().join(format!("dbmanager-history-{}.db", uuid::Uuid::new_v4()));
        let conn = open_file(&path).unwrap();
        record_query(&conn, sample(&[], &[]), &[]).unwrap();
        log_event(&conn, "info", "connect", "Connected").unwrap();
        conn.execute(
            "UPDATE queries SET created_at = '2000-01-01T00:00:00.000Z'",
            [],
        )
        .unwrap();
        conn.execute(
            "UPDATE events SET created_at = '2000-01-01T00:00:00.000Z'",
            [],
        )
        .unwrap();
        purge(&conn, 0).unwrap();
        assert_eq!(list_queries(&conn, "", 20).unwrap().len(), 1);
        purge(&conn, 7).unwrap();
        assert!(list_queries(&conn, "", 20).unwrap().is_empty());
        assert!(list_events(&conn, "", 20).unwrap().is_empty());
        let saved = save_settings(&conn, 90).unwrap();
        assert_eq!(saved.history_days, 90);
        assert_eq!(load_settings(&conn).unwrap().history_days, 90);
        let assistant = save_assistant(&conn, "https://example.com/v1", "demo", "secret").unwrap();
        assert_eq!(assistant.ai_model, "demo");
        assert_eq!(assistant.ai_api_key, "secret");
        let kept = save_settings(&conn, 7).unwrap();
        assert_eq!(kept.history_days, 7);
        assert_eq!(kept.ai_api_key, "secret");
        assert_eq!(kept.ai_base_url, "https://example.com/v1");
        assert_eq!(normalize_days(3), 30);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn caps_cached_rows() {
        let path =
            std::env::temp_dir().join(format!("dbmanager-history-{}.db", uuid::Uuid::new_v4()));
        let conn = open_file(&path).unwrap();
        let rows = (0..MAX_CACHED_ROWS + 5)
            .map(|index| vec![Some(index.to_string())])
            .collect();
        let sets = vec![ResultSet {
            columns: vec!["n".into()],
            rows,
            rows_affected: (MAX_CACHED_ROWS + 5) as u64,
            truncated: false,
        }];
        let id = record_query(&conn, sample(&sets, &[]), &[]).unwrap();
        let detail = get_query(&conn, id).unwrap();
        assert_eq!(detail.result_sets[0].rows.len(), MAX_CACHED_ROWS);
        assert!(detail.result_sets[0].truncated);
        assert_eq!(detail.query.row_count, (MAX_CACHED_ROWS + 5) as i64);
        assert!(
            detail
                .messages
                .iter()
                .any(|message| message.text.contains("first"))
        );
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn stores_a_row_backup_and_marks_it_rolled_back() {
        let path =
            std::env::temp_dir().join(format!("dbmanager-history-{}.db", uuid::Uuid::new_v4()));
        let conn = open_file(&path).unwrap();
        let backup = NewBackup {
            statement_index: 0,
            kind: "update".into(),
            table_name: "\"users\"".into(),
            columns: vec!["id".into(), "name".into()],
            rows: vec![vec![Some("1".into()), Some("Ada".into())]],
            key_columns: vec!["id".into()],
            write_columns: vec!["name".into()],
            identity_insert: false,
            overriding_system: false,
        };
        let id = record_query(&conn, sample(&[], &[]), &[backup]).unwrap();
        let listed = list_queries(&conn, "", 20).unwrap();
        assert_eq!(listed[0].backup_rows, 1);
        assert_eq!(listed[0].rollback_count, 1);
        let detail = get_query(&conn, id).unwrap();
        assert_eq!(detail.backups.len(), 1);
        assert!(!detail.backups[0].rolled_back);
        assert_eq!(detail.backups[0].table_name, "\"users\"");
        let pending = load_pending_backups(&conn, id).unwrap();
        assert_eq!(pending[0].rows[0][1].as_deref(), Some("Ada"));
        mark_rolled_back(&conn, id).unwrap();
        assert!(load_pending_backups(&conn, id).unwrap().is_empty());
        let detail = get_query(&conn, id).unwrap();
        assert!(detail.backups[0].rolled_back);
        assert_eq!(detail.query.rollback_count, 0);
        assert_eq!(detail.query.backup_rows, 1);
        delete_query(&conn, id).unwrap();
        let left: i64 = conn
            .query_row("SELECT COUNT(*) FROM snapshots", [], |row| row.get(0))
            .unwrap();
        assert_eq!(left, 0);
        let _ = std::fs::remove_file(&path);
    }
}
