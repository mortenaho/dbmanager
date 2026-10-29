use std::collections::HashMap;
use std::time::Duration;

use futures_util::TryStreamExt;
use tokio_postgres::{Client, NoTls, SimpleQueryMessage};

use crate::model::{
    quote_pg, ColumnInfo, ColumnRef, Credentials, DbObject, QueryMessage, QueryResponse, ResultSet,
    HARD_ROW_LIMIT, STORE_ROW_LIMIT,
};

use super::Outcome;

pub async fn connect(creds: &Credentials, database: &str) -> Result<Client, String> {
    let mut config = tokio_postgres::Config::new();
    config.host(&creds.host);
    config.port(creds.port);
    config.user(&creds.username);
    config.password(&creds.password);
    config.dbname(database);
    config.application_name("DB Manager");

    if creds.ssl {
        let mut builder = native_tls::TlsConnector::builder();
        if creds.trust_cert {
            builder.danger_accept_invalid_certs(true);
        }
        let tls = builder
            .build()
            .map_err(|e| format!("TLS setup failed: {e}"))?;
        let connector = postgres_native_tls::MakeTlsConnector::new(tls);
        let (client, connection) = tokio::time::timeout(Duration::from_secs(20), config.connect(connector))
            .await
            .map_err(|_| "Connection timed out after 20 seconds.".to_string())?
            .map_err(|e| e.to_string())?;
        tokio::spawn(async move {
            if let Err(error) = connection.await {
                eprintln!("postgres connection closed: {error}");
            }
        });
        Ok(client)
    } else {
        let (client, connection) = tokio::time::timeout(Duration::from_secs(20), config.connect(NoTls))
            .await
            .map_err(|_| "Connection timed out after 20 seconds.".to_string())?
            .map_err(|e| e.to_string())?;
        tokio::spawn(async move {
            if let Err(error) = connection.await {
                eprintln!("postgres connection closed: {error}");
            }
        });
        Ok(client)
    }
}

pub async fn ensure<'a>(
    map: &'a mut HashMap<String, Client>,
    creds: &Credentials,
    database: &str,
) -> Result<&'a Client, String> {
    if !map.contains_key(database) {
        let client = connect(creds, database).await?;
        map.insert(database.to_string(), client);
    }
    Ok(map.get(database).expect("postgres client was just inserted"))
}

pub async fn list_databases(client: &Client) -> Result<Vec<String>, String> {
    let rows = client
        .query(
            "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| row.try_get::<_, String>(0).map_err(|e| e.to_string()))
        .collect()
}

pub async fn list_objects(client: &Client) -> Result<Vec<DbObject>, String> {
    let rows = client
        .query(
            "SELECT n.nspname, c.relname,
                    CASE c.relkind WHEN 'v' THEN 'view' WHEN 'm' THEN 'view' ELSE 'table' END,
                    CASE WHEN c.relkind IN ('r', 'p', 'm') THEN GREATEST(c.reltuples, 0)::bigint ELSE NULL END
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p', 'v', 'm')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY 3, 1, 2",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;

    let mut objects: Vec<DbObject> = rows
        .iter()
        .map(|row| {
            Ok(DbObject {
                schema: row.try_get(0).map_err(|e| e.to_string())?,
                name: row.try_get(1).map_err(|e| e.to_string())?,
                kind: row.try_get(2).map_err(|e| e.to_string())?,
                created: String::new(),
                row_count: row.try_get(3).unwrap_or(None),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    if let Ok(routines) = client
        .query(
            "SELECT DISTINCT n.nspname, p.proname,
                    CASE WHEN p.prokind = 'p' THEN 'procedure' ELSE 'function' END
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE p.prokind IN ('f', 'p')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
             ORDER BY 3, 1, 2",
            &[],
        )
        .await
    {
        for row in routines {
            objects.push(DbObject::plain(
                row.try_get::<_, String>(0).unwrap_or_default(),
                row.try_get::<_, String>(1).unwrap_or_default(),
                row.try_get::<_, String>(2).unwrap_or_else(|_| "function".into()),
            ));
        }
        objects.retain(|object| !object.name.is_empty());
    }

    Ok(objects)
}

pub async fn list_all_columns(client: &Client) -> Result<Vec<ColumnRef>, String> {
    let rows = client
        .query(
            "SELECT table_schema, table_name, column_name, data_type
             FROM information_schema.columns
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY table_schema, table_name, ordinal_position
             LIMIT 4000",
            &[],
        )
        .await
        .map_err(|e| e.to_string())?;
    rows.iter()
        .map(|row| {
            Ok(ColumnRef {
                schema: row.try_get(0).map_err(|e| e.to_string())?,
                table: row.try_get(1).map_err(|e| e.to_string())?,
                name: row.try_get(2).map_err(|e| e.to_string())?,
                data_type: row.try_get(3).map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

pub async fn rename_relation(
    client: &Client,
    schema: &str,
    name: &str,
    new_name: &str,
) -> Result<(), String> {
    let sql = format!(
        "ALTER TABLE {}.{} RENAME TO {}",
        quote_pg(schema),
        quote_pg(name),
        quote_pg(new_name)
    );
    client.batch_execute(&sql).await.map_err(|e| e.to_string())
}

pub async fn rename_database(client: &Client, name: &str, new_name: &str) -> Result<(), String> {
    let sql = format!(
        "ALTER DATABASE {} RENAME TO {}",
        quote_pg(name),
        quote_pg(new_name)
    );
    client.batch_execute(&sql).await.map_err(|e| e.to_string())
}

pub async fn script_routine(
    client: &Client,
    schema: &str,
    name: &str,
    kind: &str,
) -> Result<String, String> {
    let prokind = if kind == "procedure" { "p" } else { "f" };
    let rows = client
        .query(
            "SELECT pg_get_functiondef(p.oid)
             FROM pg_proc p
             JOIN pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = $1 AND p.proname = $2 AND p.prokind = $3
             ORDER BY p.oid",
            &[&schema, &name, &prokind],
        )
        .await
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Err("Routine was not found.".into());
    }
    let mut parts = Vec::new();
    for row in &rows {
        parts.push(row.try_get::<_, String>(0).map_err(|e| e.to_string())?);
    }
    Ok(parts.join("\n\n"))
}

pub async fn script_table(
    client: &Client,
    schema: &str,
    name: &str,
) -> Result<(Vec<super::script::ScriptColumn>, Vec<String>), String> {
    let rows = client
        .query(
            "SELECT a.attname,
                    pg_catalog.format_type(a.atttypid, a.atttypmod),
                    a.attnotnull,
                    pg_get_expr(d.adbin, d.adrelid)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
             LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
             WHERE n.nspname = $1 AND c.relname = $2
             ORDER BY a.attnum",
            &[&schema, &name],
        )
        .await
        .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Err(format!("Table {schema}.{name} was not found."));
    }
    let mut columns = Vec::new();
    for row in &rows {
        let not_null: bool = row.try_get(2).unwrap_or(false);
        let default_sql: Option<String> = row.try_get(3).unwrap_or(None);
        columns.push(super::script::ScriptColumn {
            name: row.try_get::<_, String>(0).map_err(|e| e.to_string())?,
            data_type: row.try_get::<_, String>(1).unwrap_or_else(|_| "text".into()),
            nullable: !not_null,
            default_sql,
            identity: false,
        });
    }
    let keys = client
        .query(
            "SELECT a.attname
             FROM pg_index i
             JOIN pg_class c ON c.oid = i.indrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON true
             JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
             WHERE i.indisprimary AND n.nspname = $1 AND c.relname = $2
             ORDER BY k.ord",
            &[&schema, &name],
        )
        .await
        .map_err(|e| e.to_string())?;
    let primary_key = keys
        .iter()
        .filter_map(|row| row.try_get::<_, String>(0).ok())
        .collect();
    Ok((columns, primary_key))
}

pub async fn script_view(client: &Client, schema: &str, name: &str) -> Result<String, String> {
    let rows = client
        .query(
            "SELECT pg_get_viewdef(c.oid, true)
             FROM pg_class c
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('v', 'm')",
            &[&schema, &name],
        )
        .await
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.first() else {
        return Err(format!("View {schema}.{name} was not found."));
    };
    let definition: String = row.try_get(0).map_err(|e| e.to_string())?;
    Ok(format!(
        "CREATE OR REPLACE VIEW {}.{} AS\n{definition}",
        quote_pg(schema),
        quote_pg(name)
    ))
}

pub async fn fetch_rows(
    client: &Client,
    schema: &str,
    name: &str,
    limit: usize,
) -> Result<super::script::TableData, String> {
    let sql = format!(
        "SELECT to_jsonb(t) FROM (SELECT * FROM {}.{} LIMIT $1) AS t",
        quote_pg(schema),
        quote_pg(name)
    );
    let cap = (limit as i64).saturating_add(1);
    let rows = client
        .query(&sql, &[&cap])
        .await
        .map_err(|e| e.to_string())?;
    let truncated = rows.len() > limit;
    let mut columns = Vec::new();
    let mut data = Vec::new();
    for row in rows.iter().take(limit) {
        let value: serde_json::Value = row.try_get(0).map_err(|e| e.to_string())?;
        let Some(object) = value.as_object() else {
            continue;
        };
        if columns.is_empty() {
            columns = object.keys().cloned().collect();
        }
        data.push(
            columns
                .iter()
                .map(|column| json_cell(object.get(column)))
                .collect(),
        );
    }
    Ok(super::script::TableData {
        columns,
        rows: data,
        truncated,
    })
}

fn json_cell(value: Option<&serde_json::Value>) -> Option<String> {
    match value {
        None | Some(serde_json::Value::Null) => None,
        Some(serde_json::Value::String(text)) => Some(text.clone()),
        Some(serde_json::Value::Bool(value)) => Some(if *value { "true".into() } else { "false".into() }),
        Some(other) => Some(other.to_string()),
    }
}

pub async fn list_columns(
    client: &Client,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let rows = client
        .query(
            "SELECT a.attname,
                    pg_catalog.format_type(a.atttypid, a.atttypmod),
                    NOT a.attnotnull,
                    EXISTS (
                        SELECT 1 FROM pg_index i
                        WHERE i.indrelid = a.attrelid
                          AND i.indisprimary
                          AND a.attnum = ANY (i.indkey)
                    )
             FROM pg_attribute a
             JOIN pg_class c ON c.oid = a.attrelid
             JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = $1
               AND c.relname = $2
               AND a.attnum > 0
               AND NOT a.attisdropped
             ORDER BY a.attnum",
            &[&schema, &table],
        )
        .await
        .map_err(|e| e.to_string())?;

    rows.iter()
        .map(|row| {
            Ok(ColumnInfo {
                name: row.try_get(0).map_err(|e| e.to_string())?,
                data_type: row.try_get(1).map_err(|e| e.to_string())?,
                nullable: row.try_get(2).map_err(|e| e.to_string())?,
                primary_key: row.try_get(3).map_err(|e| e.to_string())?,
            })
        })
        .collect()
}

pub async fn execute(client: &Client, sql: &str, max_rows: usize) -> Outcome {
    let store_limit = max_rows.min(STORE_ROW_LIMIT).max(1);
    let stream = match client.simple_query_raw(sql).await {
        Ok(stream) => stream,
        Err(error) => {
            return Outcome::Failed {
                message: error.to_string(),
                drop_connection: error.is_closed(),
            };
        }
    };
    let mut stream = std::pin::pin!(stream);

    let mut sets: Vec<ResultSet> = Vec::new();
    let mut messages = Vec::new();
    let mut current: Option<ResultSet> = None;
    let mut read_rows = 0usize;
    let mut hard_stop = false;

    loop {
        if hard_stop {
            break;
        }
        let message = match stream.try_next().await {
            Ok(Some(message)) => message,
            Ok(None) => break,
            Err(error) => {
                return Outcome::Failed {
                    message: error.to_string(),
                    drop_connection: error.is_closed(),
                };
            }
        };

        match message {
            SimpleQueryMessage::RowDescription(columns) => {
                if let Some(set) = current.take() {
                    sets.push(set);
                }
                current = Some(ResultSet {
                    columns: columns.iter().map(|column| column.name().to_string()).collect(),
                    rows: Vec::new(),
                    rows_affected: 0,
                    truncated: false,
                });
            }
            SimpleQueryMessage::Row(row) => {
                read_rows += 1;
                if read_rows > HARD_ROW_LIMIT {
                    hard_stop = true;
                    if let Some(set) = current.as_mut() {
                        set.truncated = true;
                        set.rows_affected = HARD_ROW_LIMIT as u64;
                    }
                    break;
                }
                if let Some(set) = current.as_mut() {
                    if set.rows.len() < store_limit {
                        let values = (0..row.len())
                            .map(|index| row.get(index).map(|value| value.to_string()))
                            .collect();
                        set.rows.push(values);
                    } else {
                        set.truncated = true;
                    }
                }
            }
            SimpleQueryMessage::CommandComplete(count) => {
                if let Some(mut set) = current.take() {
                    set.rows_affected = count;
                    let shown = if set.columns.is_empty() {
                        count
                    } else {
                        set.rows.len() as u64
                    };
                    messages.push(QueryMessage::info(format!("({shown} rows affected)")));
                    sets.push(set);
                } else {
                    messages.push(QueryMessage::info(format!("({count} rows affected)")));
                    sets.push(ResultSet {
                        columns: Vec::new(),
                        rows: Vec::new(),
                        rows_affected: count,
                        truncated: false,
                    });
                }
            }
            _ => {}
        }
    }

    if let Some(set) = current.take() {
        sets.push(set);
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

pub async fn parse(client: &Client, sql: &str) -> Outcome {
    match client.prepare(sql).await {
        Ok(_) => Outcome::Done {
            response: QueryResponse {
                result_sets: Vec::new(),
                messages: vec![QueryMessage::info("Command(s) completed successfully.")],
                elapsed_ms: 0,
            },
            drop_connection: false,
        },
        Err(error) => Outcome::Failed {
            message: error.to_string(),
            drop_connection: error.is_closed(),
        },
    }
}
