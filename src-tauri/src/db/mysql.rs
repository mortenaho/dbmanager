use std::time::Duration;

use mysql_async::prelude::Queryable;
use mysql_async::{OptsBuilder, SslOpts, Value};

use crate::model::{
    quote_mysql, ColumnInfo, ColumnRef, Credentials, DbObject, QueryMessage, QueryResponse, ResultSet,
    HARD_ROW_LIMIT, STORE_ROW_LIMIT,
};

use super::Outcome;

pub async fn connect(creds: &Credentials, database: &str) -> Result<mysql_async::Conn, String> {
    let mut opts = OptsBuilder::default()
        .ip_or_hostname(creds.host.clone())
        .tcp_port(creds.port)
        .user(Some(creds.username.clone()))
        .pass(Some(creds.password.clone()))
        .prefer_socket(false);

    if !database.is_empty() {
        opts = opts.db_name(Some(database.to_string()));
    }

    if creds.ssl {
        let mut ssl = SslOpts::default();
        if creds.trust_cert {
            ssl = ssl
                .with_danger_accept_invalid_certs(true)
                .with_danger_skip_domain_validation(true);
        }
        opts = opts.ssl_opts(Some(ssl));
    } else {
        opts = opts.ssl_opts(None::<SslOpts>);
    }

    tokio::time::timeout(Duration::from_secs(20), mysql_async::Conn::new(opts))
        .await
        .map_err(|_| "Connection timed out after 20 seconds.".to_string())?
        .map_err(|e| e.to_string())
}

pub async fn use_database(conn: &mut mysql_async::Conn, database: &str) -> Result<(), String> {
    if database.is_empty() {
        return Ok(());
    }
    let statement = format!("USE {}", quote_mysql(database));
    conn.query_drop(statement).await.map_err(|e| e.to_string())
}

pub async fn list_databases(conn: &mut mysql_async::Conn) -> Result<Vec<String>, String> {
    let rows: Vec<mysql_async::Row> = conn
        .query("SELECT schema_name FROM information_schema.schemata ORDER BY schema_name")
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|row| cell(row, 0).unwrap_or_default())
        .filter(|name| !name.is_empty())
        .collect())
}

pub async fn list_objects(
    conn: &mut mysql_async::Conn,
    database: &str,
) -> Result<Vec<DbObject>, String> {
    let rows: Vec<mysql_async::Row> = conn
        .exec(
            "SELECT table_name,
                    CASE WHEN table_type = 'VIEW' THEN 'view' ELSE 'table' END
             FROM information_schema.tables
             WHERE table_schema = ?
             ORDER BY table_type, table_name",
            (database,),
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut objects: Vec<DbObject> = rows
        .iter()
        .map(|row| DbObject {
            schema: database.to_string(),
            name: cell(row, 0).unwrap_or_default(),
            kind: cell(row, 1).unwrap_or_else(|| "table".into()),
        })
        .filter(|object| !object.name.is_empty())
        .collect();

    if let Ok(routines) = conn
        .exec::<mysql_async::Row, _, _>(
            "SELECT routine_name,
                    CASE WHEN routine_type = 'PROCEDURE' THEN 'procedure' ELSE 'function' END
             FROM information_schema.routines
             WHERE routine_schema = ?
             ORDER BY routine_type, routine_name",
            (database,),
        )
        .await
    {
        for row in routines {
            let name = cell(&row, 0).unwrap_or_default();
            if name.is_empty() {
                continue;
            }
            objects.push(DbObject {
                schema: database.to_string(),
                name,
                kind: cell(&row, 1).unwrap_or_else(|| "function".into()),
            });
        }
    }

    Ok(objects)
}

pub async fn list_all_columns(
    conn: &mut mysql_async::Conn,
    database: &str,
) -> Result<Vec<ColumnRef>, String> {
    let rows: Vec<mysql_async::Row> = conn
        .exec(
            "SELECT table_schema, table_name, column_name, column_type
             FROM information_schema.columns
             WHERE table_schema = ?
             ORDER BY table_name, ordinal_position
             LIMIT 4000",
            (database,),
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|row| ColumnRef {
            schema: cell(row, 0).unwrap_or_else(|| database.to_string()),
            table: cell(row, 1).unwrap_or_default(),
            name: cell(row, 2).unwrap_or_default(),
            data_type: cell(row, 3).unwrap_or_default(),
        })
        .filter(|column| !column.name.is_empty())
        .collect())
}

pub async fn rename_table(
    conn: &mut mysql_async::Conn,
    database: &str,
    name: &str,
    new_name: &str,
) -> Result<(), String> {
    let sql = format!(
        "RENAME TABLE {}.{} TO {}.{}",
        quote_mysql(database),
        quote_mysql(name),
        quote_mysql(database),
        quote_mysql(new_name)
    );
    conn.query_drop(sql).await.map_err(|e| e.to_string())
}

pub async fn rename_database(
    conn: &mut mysql_async::Conn,
    old: &str,
    new: &str,
) -> Result<String, String> {
    conn.query_drop(format!("CREATE DATABASE {}", quote_mysql(new)))
        .await
        .map_err(|e| e.to_string())?;

    let tables: Vec<mysql_async::Row> = match conn
        .exec(
            "SELECT table_name
             FROM information_schema.tables
             WHERE table_schema = ? AND table_type IN ('BASE TABLE', 'VIEW')
             ORDER BY table_name",
            (old,),
        )
        .await
    {
        Ok(rows) => rows,
        Err(error) => {
            let _ = conn
                .query_drop(format!("DROP DATABASE {}", quote_mysql(new)))
                .await;
            return Err(error.to_string());
        }
    };
    let names: Vec<String> = tables
        .iter()
        .filter_map(|row| cell(row, 0))
        .filter(|name| !name.is_empty())
        .collect();

    if !names.is_empty() {
        let pairs = names
            .iter()
            .map(|name| {
                format!(
                    "{}.{} TO {}.{}",
                    quote_mysql(old),
                    quote_mysql(name),
                    quote_mysql(new),
                    quote_mysql(name)
                )
            })
            .collect::<Vec<_>>()
            .join(", ");
        if let Err(error) = conn.query_drop(format!("RENAME TABLE {pairs}")).await {
            let _ = conn
                .query_drop(format!("DROP DATABASE {}", quote_mysql(new)))
                .await;
            return Err(error.to_string());
        }
    }

    let extras = count_rows(
        conn,
        "SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = ?",
        old,
    )
    .await
    .unwrap_or(1)
        + count_rows(
            conn,
            "SELECT COUNT(*) FROM information_schema.events WHERE event_schema = ?",
            old,
        )
        .await
        .unwrap_or(0);

    if extras == 0 {
        conn.query_drop(format!("DROP DATABASE {}", quote_mysql(old)))
            .await
            .map_err(|e| e.to_string())?;
        let _ = conn.query_drop(format!("USE {}", quote_mysql(new))).await;
        Ok("Database renamed.".into())
    } else {
        let _ = conn.query_drop(format!("USE {}", quote_mysql(new))).await;
        Ok(format!(
            "Tables and views were moved to `{new}`. `{old}` was kept because it still has stored routines or events."
        ))
    }
}

pub async fn script_routine(
    conn: &mut mysql_async::Conn,
    database: &str,
    name: &str,
    kind: &str,
) -> Result<String, String> {
    let sql = if kind == "procedure" {
        format!(
            "SHOW CREATE PROCEDURE {}.{}",
            quote_mysql(database),
            quote_mysql(name)
        )
    } else {
        format!(
            "SHOW CREATE FUNCTION {}.{}",
            quote_mysql(database),
            quote_mysql(name)
        )
    };
    let mut result = conn.query_iter(sql).await.map_err(|e| e.to_string())?;
    let mut best = String::new();
    loop {
        match result.next().await {
            Ok(Some(row)) => {
                for index in 0..row.len() {
                    if let Some(text) = cell(&row, index) {
                        if text.to_ascii_uppercase().contains("CREATE") && text.len() > best.len() {
                            best = text;
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    let _ = result.drop_result().await;
    if best.is_empty() {
        Err("Routine definition was not returned.".into())
    } else {
        Ok(best)
    }
}

pub async fn script_create(
    conn: &mut mysql_async::Conn,
    database: &str,
    name: &str,
    kind: &str,
) -> Result<String, String> {
    let sql = if kind == "view" {
        format!("SHOW CREATE VIEW {}.{}", quote_mysql(database), quote_mysql(name))
    } else {
        format!("SHOW CREATE TABLE {}.{}", quote_mysql(database), quote_mysql(name))
    };
    show_create(conn, sql).await
}

pub async fn fetch_rows(
    conn: &mut mysql_async::Conn,
    database: &str,
    name: &str,
    limit: usize,
) -> Result<super::script::TableData, String> {
    let sql = format!(
        "SELECT * FROM {}.{} LIMIT {}",
        quote_mysql(database),
        quote_mysql(name),
        limit.saturating_add(1)
    );
    let mut result = conn.query_iter(sql).await.map_err(|e| e.to_string())?;
    let columns: Vec<String> = result
        .columns_ref()
        .iter()
        .map(|column| column.name_str().to_string())
        .collect();
    let mut rows = Vec::new();
    let mut truncated = false;
    loop {
        match result.next().await {
            Ok(Some(row)) => {
                if rows.len() >= limit {
                    truncated = true;
                    break;
                }
                let values = (0..row.len()).map(|index| cell(&row, index)).collect();
                rows.push(values);
            }
            Ok(None) => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    let _ = result.drop_result().await;
    Ok(super::script::TableData {
        columns,
        rows,
        truncated,
    })
}

async fn show_create(conn: &mut mysql_async::Conn, sql: String) -> Result<String, String> {
    let mut result = conn.query_iter(sql).await.map_err(|e| e.to_string())?;
    let mut best = String::new();
    loop {
        match result.next().await {
            Ok(Some(row)) => {
                for index in 0..row.len() {
                    if let Some(text) = cell(&row, index) {
                        if text.to_ascii_uppercase().contains("CREATE") && text.len() > best.len() {
                            best = text;
                        }
                    }
                }
            }
            Ok(None) => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    let _ = result.drop_result().await;
    if best.is_empty() {
        Err("Object definition was not returned.".into())
    } else {
        Ok(best)
    }
}

async fn count_rows(conn: &mut mysql_async::Conn, sql: &str, schema: &str) -> Result<i64, String> {
    let row: Option<mysql_async::Row> = conn.exec_first(sql, (schema,)).await.map_err(|e| e.to_string())?;
    Ok(row
        .as_ref()
        .and_then(|row| cell(row, 0))
        .and_then(|value| value.parse().ok())
        .unwrap_or(0))
}

pub async fn list_columns(
    conn: &mut mysql_async::Conn,
    database: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let rows: Vec<mysql_async::Row> = conn
        .exec(
            "SELECT column_name, column_type, is_nullable, column_key
             FROM information_schema.columns
             WHERE table_schema = ? AND table_name = ?
             ORDER BY ordinal_position",
            (database, table),
        )
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .map(|row| {
            let nullable = cell(row, 2).unwrap_or_default().eq_ignore_ascii_case("YES");
            let key = cell(row, 3).unwrap_or_default();
            ColumnInfo {
                name: cell(row, 0).unwrap_or_default(),
                data_type: cell(row, 1).unwrap_or_default(),
                nullable,
                primary_key: key == "PRI",
            }
        })
        .collect())
}

pub async fn execute(conn: &mut mysql_async::Conn, sql: &str, max_rows: usize) -> Outcome {
    let store_limit = max_rows.min(STORE_ROW_LIMIT).max(1);
    let mut result = match conn.query_iter(sql).await {
        Ok(result) => result,
        Err(error) => {
            return Outcome::Failed {
                message: error.to_string(),
                drop_connection: false,
            };
        }
    };

    let mut sets = Vec::new();
    let mut messages = Vec::new();
    let mut hard_stop = false;

    while !hard_stop && !result.is_empty() {
        let columns: Vec<String> = result
            .columns_ref()
            .iter()
            .map(|column| column.name_str().to_string())
            .collect();
        let affected_before = result.affected_rows();
        let mut rows = Vec::new();
        let mut read = 0usize;
        let mut truncated = false;

        loop {
            match result.next().await {
                Ok(Some(row)) => {
                    read += 1;
                    if read > HARD_ROW_LIMIT {
                        hard_stop = true;
                        truncated = true;
                        break;
                    }
                    if rows.len() < store_limit {
                        let values = (0..row.len()).map(|index| cell(&row, index)).collect();
                        rows.push(values);
                    } else {
                        truncated = true;
                    }
                }
                Ok(None) => break,
                Err(error) => {
                    return Outcome::Failed {
                        message: error.to_string(),
                        drop_connection: true,
                    };
                }
            }
        }

        let affected = if columns.is_empty() {
            affected_before
        } else {
            read as u64
        };
        messages.push(QueryMessage::info(format!("({affected} rows affected)")));
        sets.push(ResultSet {
            columns,
            rows,
            rows_affected: affected,
            truncated,
        });
    }

    if sets.is_empty() {
        let affected = result.affected_rows();
        messages.push(QueryMessage::info(format!("({affected} rows affected)")));
        sets.push(ResultSet {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: affected,
            truncated: false,
        });
    }

    if !hard_stop {
        if let Err(error) = result.drop_result().await {
            return Outcome::Failed {
                message: error.to_string(),
                drop_connection: true,
            };
        }
    }

    if sets.iter().any(|set| set.truncated) && !hard_stop {
        messages.push(QueryMessage::warn(format!(
            "Only the first {store_limit} rows are shown."
        )));
    }
    if hard_stop {
        messages.push(QueryMessage::warn(
            "Stopped reading after 20000 rows and closed this connection. Narrow the query with LIMIT or WHERE.",
        ));
    }

    Outcome::Done {
        response: QueryResponse {
            result_sets: sets,
            messages,
            elapsed_ms: 0,
        },
        drop_connection: hard_stop,
    }
}

pub async fn parse(conn: &mut mysql_async::Conn, sql: &str) -> Outcome {
    match conn.prep(sql).await {
        Ok(statement) => {
            let _ = conn.close(statement).await;
            Outcome::Done {
                response: QueryResponse {
                    result_sets: Vec::new(),
                    messages: vec![QueryMessage::info("Command(s) completed successfully.")],
                    elapsed_ms: 0,
                },
                drop_connection: false,
            }
        }
        Err(error) => Outcome::Failed {
            message: error.to_string(),
            drop_connection: false,
        },
    }
}

fn cell(row: &mysql_async::Row, index: usize) -> Option<String> {
    let value: Value = row.get(index).unwrap_or(Value::NULL);
    match value {
        Value::NULL => None,
        Value::Bytes(bytes) => Some(String::from_utf8_lossy(&bytes).into_owned()),
        Value::Int(value) => Some(value.to_string()),
        Value::UInt(value) => Some(value.to_string()),
        Value::Float(value) => Some(value.to_string()),
        Value::Double(value) => Some(value.to_string()),
        Value::Date(year, month, day, hour, minute, second, micros) => {
            if hour == 0 && minute == 0 && second == 0 && micros == 0 {
                Some(format!("{year:04}-{month:02}-{day:02}"))
            } else if micros == 0 {
                Some(format!(
                    "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}"
                ))
            } else {
                Some(format!(
                    "{year:04}-{month:02}-{day:02} {hour:02}:{minute:02}:{second:02}.{micros:06}"
                ))
            }
        }
        Value::Time(negative, days, hour, minute, second, micros) => {
            let sign = if negative { "-" } else { "" };
            Some(format!(
                "{sign}{days}d {hour:02}:{minute:02}:{second:02}.{micros:06}"
            ))
        }
    }
}
