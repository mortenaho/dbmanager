use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::ask;
use crate::history::{self, HistoryDb, QueryRecord};
use crate::model::{
    default_database, display_name, ColumnInfo, ColumnRef, ConnectResponse, Credentials, DbObject,
    EngineKind, Profile, QueryMessage, QueryResponse, ScriptResult,
};
use crate::profiles;
use crate::state::{DbState, Session};

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectPayload {
    pub engine: EngineKind,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub trust_cert: bool,
    pub encrypt: bool,
    pub ssl: bool,
}

#[tauri::command]
pub async fn connect(
    history: State<'_, HistoryDb>,
    state: State<'_, DbState>,
    payload: ConnectPayload,
) -> Result<ConnectResponse, String> {
    let host = payload.host.trim().to_string();
    let username = payload.username.trim().to_string();
    if host.is_empty() {
        return Err("Server name is required.".into());
    }
    if username.is_empty() {
        return Err("User name is required.".into());
    }
    let port = if payload.port == 0 {
        payload.engine.default_port()
    } else {
        payload.port
    };
    let database = default_database(payload.engine, &payload.database);
    let creds = Credentials {
        engine: payload.engine,
        host: host.clone(),
        port,
        username: username.clone(),
        password: payload.password,
        database: database.clone(),
        trust_cert: payload.trust_cert,
        encrypt: payload.encrypt,
        ssl: payload.ssl,
    };
    let mut conn = match crate::db::open(&creds).await {
        Ok(conn) => conn,
        Err(error) => {
            history.note(
                "error",
                "connect",
                &format!(
                    "Failed to connect to {} {}:{}. {error}",
                    history::engine_label(payload.engine),
                    host,
                    port
                ),
            );
            return Err(error);
        }
    };
    let databases = match crate::db::list_databases(&mut conn, &creds).await {
        Ok(items) => items,
        Err(_) => {
            if database.is_empty() {
                Vec::new()
            } else {
                vec![database.clone()]
            }
        }
    };
    let id = Uuid::new_v4().to_string();
    let name = display_name(&payload.name, &host, port);
    let session = Arc::new(Session {
        creds,
        conn: Mutex::new(conn),
    });
    state.sessions.lock().await.insert(id.clone(), session);
    history.note(
        "info",
        "connect",
        &format!(
            "Connected to {} {}:{} as {}.",
            history::engine_label(payload.engine),
            host,
            port,
            username
        ),
    );

    Ok(ConnectResponse {
        id,
        name,
        engine: payload.engine,
        host,
        port,
        username,
        database,
        databases,
    })
}

#[tauri::command]
pub async fn disconnect(
    history: State<'_, HistoryDb>,
    state: State<'_, DbState>,
    connection_id: String,
) -> Result<(), String> {
    let removed = state.sessions.lock().await.remove(&connection_id);
    if let Some(session) = removed {
        let creds = &session.creds;
        history.note(
            "info",
            "disconnect",
            &format!(
                "Disconnected from {} {}:{}.",
                history::engine_label(creds.engine),
                creds.host,
                creds.port
            ),
        );
    }
    Ok(())
}

#[tauri::command]
pub async fn list_databases(
    state: State<'_, DbState>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    crate::db::list_databases(&mut conn, &creds).await
}

#[tauri::command]
pub async fn list_objects(
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
) -> Result<Vec<DbObject>, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    crate::db::list_objects(&mut conn, &creds, database.trim()).await
}

#[tauri::command]
pub async fn list_columns(
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
    schema: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    crate::db::list_columns(&mut conn, &creds, database.trim(), schema.trim(), table.trim()).await
}

#[tauri::command]
pub async fn list_all_columns(
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
) -> Result<Vec<ColumnRef>, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    crate::db::list_all_columns(&mut conn, &creds, database.trim()).await
}

#[tauri::command]
pub async fn rename_object(
    history: State<'_, HistoryDb>,
    state: State<'_, DbState>,
    connection_id: String,
    kind: String,
    database: String,
    schema: String,
    name: String,
    new_name: String,
) -> Result<String, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    let result = crate::db::rename_object(
        &mut conn,
        &creds,
        kind.trim(),
        database.trim(),
        schema.trim(),
        name.trim(),
        new_name.trim(),
    )
    .await;
    match &result {
        Ok(message) => history.note("info", "rename", message),
        Err(error) => history.note("error", "rename", &format!("Rename failed: {error}")),
    }
    result
}

#[tauri::command]
pub async fn script_routine(
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
    schema: String,
    name: String,
    kind: String,
) -> Result<String, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    crate::db::script_routine(
        &mut conn,
        &creds,
        database.trim(),
        schema.trim(),
        name.trim(),
        kind.trim(),
    )
    .await
}

#[tauri::command]
pub async fn generate_script(
    history: State<'_, HistoryDb>,
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
    schema: String,
    name: String,
    kind: String,
    include_create: bool,
    include_data: bool,
) -> Result<ScriptResult, String> {
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let mut conn = session.conn.lock().await;
    let result = crate::db::generate_script(
        &mut conn,
        &creds,
        database.trim(),
        schema.trim(),
        name.trim(),
        kind.trim(),
        include_create,
        include_data,
    )
    .await;
    match &result {
        Ok(script) => history.note(
            "info",
            "script",
            &format!(
                "Generated a {} script for {} ({} bytes, {} warning(s)).",
                if include_data { "backup" } else { "schema" },
                database.trim(),
                script.sql.len(),
                script.warnings.len()
            ),
        ),
        Err(error) => history.note("error", "script", error),
    }
    result
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Choose a file path.".into());
    }
    if let Some(parent) = std::path::Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Choose a file path.".into());
    }
    let meta = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > 2_000_000 {
        return Err("The design file is too large.".into());
    }
    std::fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_binary_file(path: String, contents_base64: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err("Choose a file path.".into());
    }
    let bytes = decode_base64(contents_base64.trim())?;
    if let Some(parent) = std::path::Path::new(path).parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

fn decode_base64(input: &str) -> Result<Vec<u8>, String> {
    fn value(byte: u8) -> Result<u8, String> {
        match byte {
            b'A'..=b'Z' => Ok(byte - b'A'),
            b'a'..=b'z' => Ok(byte - b'a' + 26),
            b'0'..=b'9' => Ok(byte - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("The file contents are not valid.".into()),
        }
    }
    let bytes: Vec<u8> = input.bytes().filter(|byte| !byte.is_ascii_whitespace()).collect();
    let mut end = bytes.len();
    while end > 0 && bytes[end - 1] == b'=' {
        end -= 1;
    }
    if end != bytes.len() && bytes[..end].contains(&b'=') {
        return Err("The file contents are not valid.".into());
    }
    if end % 4 == 1 {
        return Err("The file contents are not valid.".into());
    }
    let mut out = Vec::with_capacity(end * 3 / 4);
    let mut index = 0;
    while index + 4 <= end {
        let a = value(bytes[index])?;
        let b = value(bytes[index + 1])?;
        let c = value(bytes[index + 2])?;
        let d = value(bytes[index + 3])?;
        out.push((a << 2) | (b >> 4));
        out.push((b << 4) | (c >> 2));
        out.push((c << 6) | d);
        index += 4;
    }
    let rest = end - index;
    if rest == 2 {
        let a = value(bytes[index])?;
        let b = value(bytes[index + 1])?;
        out.push((a << 2) | (b >> 4));
    } else if rest == 3 {
        let a = value(bytes[index])?;
        let b = value(bytes[index + 1])?;
        let c = value(bytes[index + 2])?;
        out.push((a << 2) | (b >> 4));
        out.push((b << 4) | (c >> 2));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::decode_base64;

    #[test]
    fn decodes_base64() {
        assert_eq!(decode_base64("YQ==").unwrap(), b"a");
        assert_eq!(decode_base64("YWI=").unwrap(), b"ab");
        assert_eq!(decode_base64("YWJj").unwrap(), b"abc");
        assert_eq!(decode_base64("AQID").unwrap(), [1, 2, 3]);
    }
}

#[tauri::command]
pub async fn execute_sql(
    history: State<'_, HistoryDb>,
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
    sql: String,
    max_rows: Option<u32>,
) -> Result<QueryResponse, String> {
    if sql.trim().is_empty() {
        return Err("The query is empty.".into());
    }
    let session = match session(&state, &connection_id).await {
        Ok(session) => session,
        Err(error) => {
            history.note("error", "query", &error);
            return Err(error);
        }
    };
    if let Some(warning) = crate::db::guard::unconditional_write_warning(&sql) {
        let response = QueryResponse {
            result_sets: Vec::new(),
            messages: vec![QueryMessage::warn(warning)],
            elapsed_ms: 0,
        };
        remember(&history, &session.creds, database.trim(), &sql, 0, Ok(&response));
        return Ok(response);
    }
    let creds = session.creds.clone();
    let started = Instant::now();
    let mut conn = session.conn.lock().await;
    let database = database.trim();
    match crate::db::execute(&mut conn, &creds, database, &sql, max_rows.unwrap_or(5_000) as usize).await {
        Ok(mut response) => {
            let elapsed = started.elapsed().as_millis();
            response.elapsed_ms = elapsed;
            response.messages.push(QueryMessage::info(format!(
                "Completion time: {}",
                chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
            )));
            remember(&history, &creds, database, &sql, elapsed, Ok(&response));
            Ok(response)
        }
        Err(error) => {
            remember(&history, &creds, database, &sql, started.elapsed().as_millis(), Err(error.as_str()));
            Err(error)
        }
    }
}

#[tauri::command]
pub async fn parse_sql(
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
    sql: String,
) -> Result<QueryResponse, String> {
    if sql.trim().is_empty() {
        return Err("The query is empty.".into());
    }
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let started = Instant::now();
    let mut conn = session.conn.lock().await;
    let mut response = crate::db::parse(&mut conn, &creds, database.trim(), &sql).await?;
    response.elapsed_ms = started.elapsed().as_millis();
    response.messages.push(QueryMessage::info(format!(
        "Completion time: {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
    )));
    Ok(response)
}

#[tauri::command]
pub fn load_profiles(app: AppHandle) -> Result<Vec<Profile>, String> {
    profiles::load(&app)
}

#[tauri::command]
pub fn save_profile(app: AppHandle, profile: Profile) -> Result<Profile, String> {
    profiles::save_one(&app, profile)
}

#[tauri::command]
pub fn delete_profile(app: AppHandle, id: String) -> Result<(), String> {
    profiles::delete(&app, &id)
}

fn remember(
    history: &HistoryDb,
    creds: &Credentials,
    database: &str,
    sql: &str,
    elapsed_ms: u128,
    outcome: Result<&QueryResponse, &str>,
) {
    let server = format!("{}:{}", creds.host, creds.port);
    match outcome {
        Ok(response) => {
            let failed = response.messages.iter().any(|message| message.level == "error");
            let blocked = !failed
                && response.result_sets.is_empty()
                && response.messages.iter().any(|message| message.level == "warn");
            let error = response
                .messages
                .iter()
                .find(|message| message.level == "error" || (blocked && message.level == "warn"))
                .map(|message| message.text.as_str())
                .unwrap_or("");
            history.remember(QueryRecord {
                engine: creds.engine,
                server: &server,
                database,
                sql,
                elapsed_ms,
                status: if failed {
                    "error"
                } else if blocked {
                    "blocked"
                } else {
                    "ok"
                },
                error,
                messages: &response.messages,
                sets: &response.result_sets,
            });
        }
        Err(error) => {
            let messages = vec![QueryMessage {
                level: "error".into(),
                text: error.to_string(),
            }];
            history.remember(QueryRecord {
                engine: creds.engine,
                server: &server,
                database,
                sql,
                elapsed_ms,
                status: "error",
                error,
                messages: &messages,
                sets: &[],
            });
        }
    }
}

#[tauri::command]
pub fn list_history(
    history: State<'_, HistoryDb>,
    needle: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<history::HistoryQuery>, String> {
    history.with_conn(|conn| history::list_queries(conn, needle.as_deref().unwrap_or(""), limit.unwrap_or(200) as i64))
}

#[tauri::command]
pub fn get_history(history: State<'_, HistoryDb>, id: i64) -> Result<history::HistoryDetail, String> {
    history.with_conn(|conn| history::get_query(conn, id))
}

#[tauri::command]
pub fn delete_history(history: State<'_, HistoryDb>, id: i64) -> Result<(), String> {
    history.with_conn(|conn| history::delete_query(conn, id))
}

#[tauri::command]
pub fn clear_history(history: State<'_, HistoryDb>) -> Result<(), String> {
    history.with_conn(history::clear_all)
}

#[tauri::command]
pub fn list_events(
    history: State<'_, HistoryDb>,
    needle: Option<String>,
    limit: Option<u32>,
) -> Result<Vec<history::AppEvent>, String> {
    history.with_conn(|conn| history::list_events(conn, needle.as_deref().unwrap_or(""), limit.unwrap_or(200) as i64))
}

#[tauri::command]
pub fn log_event(history: State<'_, HistoryDb>, level: String, kind: String, message: String) -> Result<(), String> {
    history.with_conn(|conn| history::log_event(conn, &level, &kind, &message))
}

#[tauri::command]
pub fn load_settings(history: State<'_, HistoryDb>) -> Result<history::AppSettings, String> {
    history.with_conn(history::load_settings)
}

#[tauri::command]
pub fn save_settings(
    history: State<'_, HistoryDb>,
    history_days: u32,
    ai_base_url: Option<String>,
    ai_model: Option<String>,
    ai_api_key: Option<String>,
) -> Result<history::AppSettings, String> {
    history.with_conn(|conn| {
        history::save_settings(conn, history_days)?;
        if ai_base_url.is_some() || ai_model.is_some() || ai_api_key.is_some() {
            let current = history::load_settings(conn)?;
            history::save_assistant(
                conn,
                ai_base_url.as_deref().unwrap_or(&current.ai_base_url),
                ai_model.as_deref().unwrap_or(&current.ai_model),
                ai_api_key.as_deref().unwrap_or(&current.ai_api_key),
            )
        } else {
            history::load_settings(conn)
        }
    })
}

#[tauri::command]
pub fn ask_sql(
    history: State<'_, HistoryDb>,
    engine: String,
    database: String,
    schema: String,
    question: String,
) -> Result<ask::AskReply, String> {
    let settings = history.with_conn(history::load_settings)?;
    ask::complete(&settings, &engine, &database, &schema, &question)
}

async fn session(state: &DbState, id: &str) -> Result<Arc<Session>, String> {
    state
        .sessions
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "This connection is closed. Connect to the server again.".to_string())
}
