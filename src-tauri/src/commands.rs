use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, State};
use tokio::sync::Mutex;
use uuid::Uuid;

use crate::model::{
    default_database, display_name, ColumnInfo, ColumnRef, ConnectResponse, Credentials, DbObject,
    EngineKind, Profile, QueryMessage, QueryResponse,
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
    let mut conn = crate::db::open(&creds).await?;
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
pub async fn disconnect(state: State<'_, DbState>, connection_id: String) -> Result<(), String> {
    state.sessions.lock().await.remove(&connection_id);
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
    crate::db::rename_object(
        &mut conn,
        &creds,
        kind.trim(),
        database.trim(),
        schema.trim(),
        name.trim(),
        new_name.trim(),
    )
    .await
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
pub async fn execute_sql(
    state: State<'_, DbState>,
    connection_id: String,
    database: String,
    sql: String,
    max_rows: Option<u32>,
) -> Result<QueryResponse, String> {
    if sql.trim().is_empty() {
        return Err("The query is empty.".into());
    }
    let session = session(&state, &connection_id).await?;
    let creds = session.creds.clone();
    let started = Instant::now();
    let mut conn = session.conn.lock().await;
    let mut response = crate::db::execute(
        &mut conn,
        &creds,
        database.trim(),
        &sql,
        max_rows.unwrap_or(5_000) as usize,
    )
    .await?;
    response.elapsed_ms = started.elapsed().as_millis();
    response.messages.push(QueryMessage::info(format!(
        "Completion time: {}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f")
    )));
    Ok(response)
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

async fn session(state: &DbState, id: &str) -> Result<Arc<Session>, String> {
    state
        .sessions
        .lock()
        .await
        .get(id)
        .cloned()
        .ok_or_else(|| "This connection is closed. Connect to the server again.".to_string())
}
