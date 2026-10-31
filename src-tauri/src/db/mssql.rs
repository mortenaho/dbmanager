use std::time::Duration;

use futures_util::TryStreamExt;
use tiberius::{AuthMethod, Client, ColumnType, Config, EncryptionLevel, QueryItem, ToSql};
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

use crate::model::{
    ColumnInfo, ColumnRef, Credentials, DbObject, HARD_ROW_LIMIT, QueryMessage, QueryResponse,
    ResultSet, STORE_ROW_LIMIT, parse_row_count, quote_mssql,
};

use super::Outcome;

pub type MssqlClient = Client<Compat<TcpStream>>;

pub async fn connect(creds: &Credentials, database: &str) -> Result<MssqlClient, String> {
    let mut config = Config::new();
    config.host(&creds.host);
    config.port(creds.port);
    config.authentication(AuthMethod::sql_server(&creds.username, &creds.password));
    config.application_name("DB Manager");
    if !database.is_empty() {
        config.database(database);
    }
    if creds.trust_cert {
        config.trust_cert();
    }
    config.encryption(if creds.encrypt {
        EncryptionLevel::Required
    } else {
        EncryptionLevel::Off
    });

    let address = config.get_addr();
    let tcp = tokio::time::timeout(Duration::from_secs(20), TcpStream::connect(&address))
        .await
        .map_err(|_| "Connection timed out after 20 seconds.".to_string())?
        .map_err(|e| format!("Could not reach {address}: {e}"))?;
    tcp.set_nodelay(true).map_err(|e| e.to_string())?;

    tokio::time::timeout(
        Duration::from_secs(20),
        Client::connect(config, tcp.compat_write()),
    )
    .await
    .map_err(|_| "Connection timed out during SQL Server login.".to_string())?
    .map_err(|e| e.to_string())
}

pub async fn use_database(client: &mut MssqlClient, database: &str) -> Result<(), String> {
    if database.is_empty() {
        return Ok(());
    }
    // Client::execute sends the statement through sp_executesql. USE inside
    // that procedure does not stick, so the next query still runs in the login
    // database and index/foreign-key lookups come back empty.
    let statement = format!("USE {}", quote_mssql(database));
    exec(client, &statement).await
}

pub async fn list_databases(client: &mut MssqlClient) -> Result<Vec<String>, String> {
    let rows = query_rows(client, "SELECT name FROM sys.databases ORDER BY name", &[]).await?;
    Ok(rows.iter().filter_map(|row| cell(row, 0)).collect())
}

pub async fn list_objects(
    client: &mut MssqlClient,
    database: &str,
) -> Result<Vec<DbObject>, String> {
    let db = quote_mssql(database);
    let sql = format!(
        "SELECT s.name, t.name, 'table', CONVERT(varchar(19), t.create_date, 120),
                CAST((SELECT SUM(p.rows) FROM {db}.sys.partitions p WHERE p.object_id = t.object_id AND p.index_id IN (0, 1)) AS bigint)
         FROM {db}.sys.tables t
         INNER JOIN {db}.sys.schemas s ON s.schema_id = t.schema_id
         WHERE t.is_ms_shipped = 0
         UNION ALL
         SELECT s.name, v.name, 'view', CONVERT(varchar(19), v.create_date, 120), CAST(NULL AS bigint)
         FROM {db}.sys.views v
         INNER JOIN {db}.sys.schemas s ON s.schema_id = v.schema_id
         WHERE v.is_ms_shipped = 0
         UNION ALL
         SELECT s.name, p.name, 'procedure', CONVERT(varchar(19), p.create_date, 120), CAST(NULL AS bigint)
         FROM {db}.sys.procedures p
         INNER JOIN {db}.sys.schemas s ON s.schema_id = p.schema_id
         WHERE p.is_ms_shipped = 0
         UNION ALL
         SELECT s.name, o.name, 'function', CONVERT(varchar(19), o.create_date, 120), CAST(NULL AS bigint)
         FROM {db}.sys.objects o
         INNER JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         WHERE o.is_ms_shipped = 0 AND o.type IN ('FN', 'IF', 'TF', 'FS', 'FT')
         ORDER BY 3, 1, 2"
    );
    let rows = query_rows(client, &sql, &[]).await?;
    Ok(rows
        .iter()
        .map(|row| DbObject {
            schema: cell(row, 0).unwrap_or_default(),
            name: cell(row, 1).unwrap_or_default(),
            kind: cell(row, 2).unwrap_or_else(|| "table".into()),
            created: cell(row, 3).unwrap_or_default(),
            row_count: parse_row_count(cell(row, 4)),
        })
        .filter(|object| !object.name.is_empty())
        .collect())
}

pub async fn backup_columns(
    client: &mut MssqlClient,
    database: &str,
    schema: Option<&str>,
    table: &str,
) -> Result<(String, String, Vec<super::backup::BackupColumn>), String> {
    let catalog = if database.is_empty() {
        "sys".to_string()
    } else {
        format!("{}.sys", quote_mssql(database))
    };
    let (schema_name, table_name) = if let Some(schema) = schema {
        (schema.to_string(), table.to_string())
    } else {
        let sql = format!(
            "SELECT s.name, t.name
             FROM {catalog}.tables t
             INNER JOIN {catalog}.schemas s ON s.schema_id = t.schema_id
             WHERE t.object_id = OBJECT_ID(@P1)"
        );
        let params: [&dyn ToSql; 1] = [&table];
        let rows = query_rows(client, &sql, &params).await?;
        let Some(row) = rows.first() else {
            return Err(format!(
                "Could not find table {table} to back it up. The statement was not run."
            ));
        };
        (
            cell(row, 0).unwrap_or_default(),
            cell(row, 1).unwrap_or_else(|| table.to_string()),
        )
    };
    if schema_name.is_empty() || table_name.is_empty() {
        return Err(format!(
            "Could not find table {table} to back it up. The statement was not run."
        ));
    }
    let sql = format!(
        "SELECT c.name,
                CASE WHEN EXISTS (
                    SELECT 1
                    FROM {catalog}.indexes i
                    INNER JOIN {catalog}.index_columns ic
                        ON ic.object_id = i.object_id AND ic.index_id = i.index_id
                    WHERE i.is_primary_key = 1
                      AND ic.object_id = c.object_id
                      AND ic.column_id = c.column_id
                ) THEN 1 ELSE 0 END,
                CAST(c.is_identity AS int),
                CAST(c.is_computed AS int)
         FROM {catalog}.columns c
         INNER JOIN {catalog}.tables t ON t.object_id = c.object_id
         INNER JOIN {catalog}.schemas s ON s.schema_id = t.schema_id
         WHERE s.name = @P1 AND t.name = @P2
         ORDER BY c.column_id"
    );
    let params: [&dyn ToSql; 2] = [&schema_name, &table_name];
    let rows = query_rows(client, &sql, &params).await?;
    if rows.is_empty() {
        return Err(format!(
            "Could not find table {schema_name}.{table_name} to back it up. The statement was not run."
        ));
    }
    let columns = rows
        .iter()
        .map(|row| super::backup::BackupColumn {
            name: cell(row, 0).unwrap_or_default(),
            primary_key: row.try_get::<i32, _>(1).ok().flatten().unwrap_or(0) == 1,
            identity: row.try_get::<i32, _>(2).ok().flatten().unwrap_or(0) == 1,
            identity_always: false,
            generated: row.try_get::<i32, _>(3).ok().flatten().unwrap_or(0) == 1,
        })
        .collect();
    Ok((schema_name, table_name, columns))
}

pub async fn list_columns(
    client: &mut MssqlClient,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    let db = quote_mssql(database);
    let sql = format!(
        "SELECT c.name,
                ty.name,
                CAST(c.max_length AS int),
                CAST(c.precision AS int),
                CAST(c.scale AS int),
                CAST(c.is_nullable AS int),
                CASE WHEN EXISTS (
                    SELECT 1
                    FROM {db}.sys.index_columns ic
                    INNER JOIN {db}.sys.indexes i
                        ON i.object_id = ic.object_id AND i.index_id = ic.index_id
                    WHERE i.is_primary_key = 1
                      AND ic.object_id = c.object_id
                      AND ic.column_id = c.column_id
                ) THEN 1 ELSE 0 END
         FROM {db}.sys.columns c
         INNER JOIN {db}.sys.types ty ON c.user_type_id = ty.user_type_id
         INNER JOIN {db}.sys.objects o ON o.object_id = c.object_id
         INNER JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         WHERE s.name = @P1 AND o.name = @P2
         ORDER BY c.column_id"
    );
    let params: [&dyn ToSql; 2] = [&schema, &table];
    let rows = query_rows(client, &sql, &params).await?;
    Ok(rows
        .iter()
        .map(|row| {
            let type_name = cell(row, 1).unwrap_or_default();
            let max_length = row.try_get::<i32, _>(2).ok().flatten().unwrap_or(0);
            let precision = row.try_get::<i32, _>(3).ok().flatten().unwrap_or(0);
            let scale = row.try_get::<i32, _>(4).ok().flatten().unwrap_or(0);
            let nullable = row.try_get::<i32, _>(5).ok().flatten().unwrap_or(1) == 1;
            let primary_key = row.try_get::<i32, _>(6).ok().flatten().unwrap_or(0) == 1;
            ColumnInfo {
                name: cell(row, 0).unwrap_or_default(),
                data_type: format_type(&type_name, max_length, precision, scale),
                nullable,
                primary_key,
            }
        })
        .collect())
}

pub async fn list_all_columns(
    client: &mut MssqlClient,
    database: &str,
) -> Result<Vec<ColumnRef>, String> {
    let db = quote_mssql(database);
    let sql = format!(
        "SELECT TOP (4000) TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE
         FROM {db}.INFORMATION_SCHEMA.COLUMNS
         ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
    );
    let rows = query_rows(client, &sql, &[]).await?;
    Ok(rows
        .iter()
        .map(|row| ColumnRef {
            schema: cell(row, 0).unwrap_or_default(),
            table: cell(row, 1).unwrap_or_default(),
            name: cell(row, 2).unwrap_or_default(),
            data_type: cell(row, 3).unwrap_or_default(),
        })
        .filter(|column| !column.name.is_empty())
        .collect())
}

pub async fn rename_relation(
    client: &mut MssqlClient,
    schema: &str,
    name: &str,
    new_name: &str,
) -> Result<(), String> {
    let qualified = format!("{}.{}", quote_mssql(schema), quote_mssql(name));
    let sql = format!(
        "EXEC sp_rename {}, {}, N'OBJECT'",
        sql_nstring(&qualified),
        sql_nstring(new_name)
    );
    exec(client, &sql).await
}

pub async fn rename_database(
    client: &mut MssqlClient,
    name: &str,
    new_name: &str,
) -> Result<(), String> {
    let sql = format!(
        "ALTER DATABASE {} MODIFY NAME = {}",
        quote_mssql(name),
        quote_mssql(new_name)
    );
    exec(client, &sql).await
}

pub async fn script_routine(
    client: &mut MssqlClient,
    database: &str,
    schema: &str,
    name: &str,
) -> Result<String, String> {
    let db = quote_mssql(database);
    let sql = format!(
        "SELECT m.definition
         FROM {db}.sys.sql_modules m
         INNER JOIN {db}.sys.objects o ON o.object_id = m.object_id
         INNER JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         WHERE s.name = @P1 AND o.name = @P2"
    );
    let params: [&dyn ToSql; 2] = [&schema, &name];
    let rows = query_rows(client, &sql, &params).await?;
    let Some(row) = rows.first() else {
        return Err("Routine was not found.".into());
    };
    match cell(row, 0) {
        Some(text) if !text.is_empty() && !text.starts_with('<') => Ok(text),
        _ => Err("This routine is encrypted, so its definition cannot be scripted.".into()),
    }
}

pub async fn script_table(
    client: &mut MssqlClient,
    database: &str,
    schema: &str,
    name: &str,
) -> Result<(Vec<super::script::ScriptColumn>, Vec<String>), String> {
    let db = quote_mssql(database);
    let sql = format!(
        "SELECT c.name,
                ty.name,
                CAST(c.max_length AS int),
                CAST(c.precision AS int),
                CAST(c.scale AS int),
                CAST(c.is_nullable AS int),
                dc.definition,
                CAST(c.is_identity AS int)
         FROM {db}.sys.columns c
         INNER JOIN {db}.sys.types ty ON c.user_type_id = ty.user_type_id
         INNER JOIN {db}.sys.objects o ON o.object_id = c.object_id
         INNER JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         LEFT JOIN {db}.sys.default_constraints dc
            ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id
         WHERE s.name = @P1 AND o.name = @P2
         ORDER BY c.column_id"
    );
    let params: [&dyn ToSql; 2] = [&schema, &name];
    let rows = query_rows(client, &sql, &params).await?;
    if rows.is_empty() {
        return Err(format!("Table {schema}.{name} was not found."));
    }
    let mut columns = Vec::new();
    for row in &rows {
        let type_name = cell(row, 1).unwrap_or_else(|| "nvarchar".into());
        let max_length = row.try_get::<i32, _>(2).ok().flatten().unwrap_or(0);
        let precision = row.try_get::<i32, _>(3).ok().flatten().unwrap_or(0);
        let scale = row.try_get::<i32, _>(4).ok().flatten().unwrap_or(0);
        let nullable = row.try_get::<i32, _>(5).ok().flatten().unwrap_or(1) == 1;
        let identity = row.try_get::<i32, _>(7).ok().flatten().unwrap_or(0) == 1;
        columns.push(super::script::ScriptColumn {
            name: cell(row, 0).unwrap_or_default(),
            data_type: format_type(&type_name, max_length, precision, scale),
            nullable,
            default_sql: cell(row, 6),
            identity,
        });
    }
    let pk_sql = format!(
        "SELECT c.name
         FROM {db}.sys.indexes i
         INNER JOIN {db}.sys.index_columns ic
            ON ic.object_id = i.object_id AND ic.index_id = i.index_id
         INNER JOIN {db}.sys.columns c
            ON c.object_id = ic.object_id AND c.column_id = ic.column_id
         INNER JOIN {db}.sys.objects o ON o.object_id = i.object_id
         INNER JOIN {db}.sys.schemas s ON s.schema_id = o.schema_id
         WHERE i.is_primary_key = 1 AND s.name = @P1 AND o.name = @P2
         ORDER BY ic.key_ordinal"
    );
    let keys = query_rows(client, &pk_sql, &params).await?;
    let primary_key = keys.iter().filter_map(|row| cell(row, 0)).collect();
    Ok((columns, primary_key))
}

pub async fn fetch_rows(
    client: &mut MssqlClient,
    schema: &str,
    name: &str,
    limit: usize,
) -> Result<super::script::TableData, String> {
    let sql = format!(
        "SELECT TOP ({}) * FROM {}.{}",
        limit.saturating_add(1),
        quote_mssql(schema),
        quote_mssql(name)
    );
    let rows = query_rows(client, &sql, &[]).await?;
    let truncated = rows.len() > limit;
    let columns = rows
        .first()
        .map(|row| {
            row.columns()
                .iter()
                .map(|column| column.name().to_string())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let data = rows
        .iter()
        .take(limit)
        .map(|row| (0..row.len()).map(|index| cell(row, index)).collect())
        .collect();
    Ok(super::script::TableData {
        columns,
        rows: data,
        truncated,
    })
}

async fn exec(client: &mut MssqlClient, sql: &str) -> Result<(), String> {
    let mut stream = client.simple_query(sql).await.map_err(|e| e.to_string())?;
    while stream
        .try_next()
        .await
        .map_err(|e| e.to_string())?
        .is_some()
    {}
    Ok(())
}

fn sql_nstring(value: &str) -> String {
    format!("N'{}'", value.replace('\'', "''"))
}

pub async fn execute(client: &mut MssqlClient, sql: &str, max_rows: usize) -> Outcome {
    // simple_query discards the DONE token, which is the only place SQL Server
    // reports how many rows an INSERT, UPDATE, or DELETE changed. A batch with
    // no result set can go through execute(), which keeps those counts.
    if !batch_returns_rows(sql) {
        return execute_counted(client, sql).await;
    }
    let store_limit = max_rows.min(STORE_ROW_LIMIT).max(1);
    let mut stream = match client.simple_query(sql).await {
        Ok(stream) => stream,
        Err(error) => {
            return Outcome::Failed {
                message: error.to_string(),
                drop_connection: false,
            };
        }
    };

    let mut sets: Vec<ResultSet> = Vec::new();
    let mut messages = Vec::new();
    let mut current: Option<ResultSet> = None;
    let mut hard_stop = false;

    while !hard_stop {
        match stream.try_next().await {
            Ok(Some(QueryItem::Metadata(meta))) => {
                if let Some(set) = current.take() {
                    finish_set(set, &mut sets, &mut messages);
                }
                current = Some(ResultSet {
                    columns: meta
                        .columns()
                        .iter()
                        .map(|column| column.name().to_string())
                        .collect(),
                    rows: Vec::new(),
                    rows_affected: 0,
                    truncated: false,
                });
            }
            Ok(Some(QueryItem::Row(row))) => {
                let Some(set) = current.as_mut() else {
                    continue;
                };
                set.rows_affected += 1;
                if set.rows_affected > HARD_ROW_LIMIT as u64 {
                    set.rows_affected = HARD_ROW_LIMIT as u64;
                    set.truncated = true;
                    hard_stop = true;
                    break;
                }
                if set.rows.len() < store_limit {
                    let values = (0..row.columns().len())
                        .map(|index| cell(&row, index))
                        .collect();
                    set.rows.push(values);
                } else {
                    set.truncated = true;
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

    if let Some(set) = current.take() {
        finish_set(set, &mut sets, &mut messages);
    }

    if sets.is_empty() {
        messages.push(QueryMessage::info("Commands completed successfully."));
    }
    if sets.iter().any(|set| set.truncated) && !hard_stop {
        messages.push(QueryMessage::warn(format!(
            "Only the first {store_limit} rows are shown."
        )));
    }
    if hard_stop {
        messages.push(QueryMessage::warn(
            "Stopped reading after 20000 rows and closed this connection. Narrow the query with TOP or WHERE.",
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

pub async fn parse(client: &mut MssqlClient, sql: &str) -> Outcome {
    if let Err(error) = client.execute("SET PARSEONLY ON", &[]).await {
        return Outcome::Failed {
            message: error.to_string(),
            drop_connection: true,
        };
    }
    let parsed = client.execute(sql, &[]).await;
    let turned_off = client.execute("SET PARSEONLY OFF", &[]).await;
    if let Err(error) = turned_off {
        return Outcome::Failed {
            message: format!(
                "{}\nAlso failed to turn PARSEONLY off: {error}",
                parsed.err().map(|e| e.to_string()).unwrap_or_default()
            ),
            drop_connection: true,
        };
    }
    match parsed {
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
            drop_connection: false,
        },
    }
}

fn finish_set(set: ResultSet, sets: &mut Vec<ResultSet>, messages: &mut Vec<QueryMessage>) {
    messages.push(QueryMessage::affected(set.rows_affected));
    sets.push(set);
}

async fn execute_counted(client: &mut MssqlClient, sql: &str) -> Outcome {
    let result = match client.execute(sql, &[]).await {
        Ok(result) => result,
        Err(error) => {
            return Outcome::Failed {
                message: error.to_string(),
                drop_connection: false,
            };
        }
    };
    let counts = result.rows_affected();
    let mut sets = Vec::new();
    let mut messages = Vec::new();
    if counts.is_empty() {
        messages.push(QueryMessage::info("Commands completed successfully."));
    } else {
        for count in counts {
            messages.push(QueryMessage::affected(*count));
            sets.push(ResultSet {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: *count,
                truncated: false,
            });
        }
    }
    Outcome::Done {
        response: QueryResponse {
            result_sets: sets,
            messages,
            elapsed_ms: 0,
        },
        drop_connection: false,
    }
}

fn batch_returns_rows(sql: &str) -> bool {
    let mut saw_statement = false;
    for statement in split_statements(sql) {
        let words = statement_words(&statement);
        let Some(first) = words.first() else {
            continue;
        };
        saw_statement = true;
        if matches!(
            first.as_str(),
            "SELECT"
                | "WITH"
                | "EXEC"
                | "EXECUTE"
                | "FETCH"
                | "OPEN"
                | "SHOW"
                | "EXPLAIN"
                | "TABLE"
                | "VALUES"
                | "IF"
                | "WHILE"
        ) {
            return true;
        }
        if matches!(first.as_str(), "INSERT" | "UPDATE" | "DELETE" | "MERGE")
            && words.iter().any(|word| word == "OUTPUT")
        {
            return true;
        }
    }
    !saw_statement
}

fn split_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut chars = sql.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '-' && chars.peek() == Some(&'-') {
            current.push(ch);
            current.push(chars.next().unwrap_or('-'));
            for next in chars.by_ref() {
                current.push(next);
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            current.push(ch);
            current.push(chars.next().unwrap_or('*'));
            while let Some(next) = chars.next() {
                current.push(next);
                if next == '*' && chars.peek() == Some(&'/') {
                    current.push(chars.next().unwrap_or('/'));
                    break;
                }
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            current.push(ch);
            while let Some(next) = chars.next() {
                current.push(next);
                if next == ch {
                    if chars.peek() == Some(&ch) {
                        current.push(chars.next().unwrap_or(ch));
                        continue;
                    }
                    break;
                }
            }
            continue;
        }
        if ch == '[' {
            current.push(ch);
            for next in chars.by_ref() {
                current.push(next);
                if next == ']' {
                    break;
                }
            }
            continue;
        }
        if ch == ';' {
            statements.push(std::mem::take(&mut current));
            continue;
        }
        current.push(ch);
    }
    if !current.trim().is_empty() {
        statements.push(current);
    }
    statements
}

fn statement_words(sql: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut chars = sql.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch.is_whitespace() {
            continue;
        }
        if ch == '-' && chars.peek() == Some(&'-') {
            chars.next();
            for next in chars.by_ref() {
                if next == '\n' {
                    break;
                }
            }
            continue;
        }
        if ch == '/' && chars.peek() == Some(&'*') {
            chars.next();
            while let Some(next) = chars.next() {
                if next == '*' && chars.peek() == Some(&'/') {
                    chars.next();
                    break;
                }
            }
            continue;
        }
        if ch == '\'' || ch == '"' {
            while let Some(next) = chars.next() {
                if next == ch {
                    if chars.peek() == Some(&ch) {
                        chars.next();
                        continue;
                    }
                    break;
                }
            }
            continue;
        }
        if ch == '[' {
            for next in chars.by_ref() {
                if next == ']' {
                    break;
                }
            }
            continue;
        }
        if ch == '_' || ch.is_ascii_alphanumeric() {
            let mut word = String::new();
            word.push(ch);
            while let Some(next) = chars.peek().copied() {
                if next == '_' || next.is_ascii_alphanumeric() {
                    word.push(next);
                    chars.next();
                } else {
                    break;
                }
            }
            words.push(word.to_ascii_uppercase());
        }
    }
    words
}

async fn query_rows(
    client: &mut MssqlClient,
    sql: &str,
    params: &[&dyn ToSql],
) -> Result<Vec<tiberius::Row>, String> {
    let stream = client.query(sql, params).await.map_err(|e| e.to_string())?;
    stream.into_first_result().await.map_err(|e| e.to_string())
}

fn cell(row: &tiberius::Row, index: usize) -> Option<String> {
    macro_rules! try_ty {
        ($ty:ty, $map:expr) => {
            match row.try_get::<$ty, _>(index) {
                Ok(Some(value)) => return Some($map(value)),
                Ok(None) => return None,
                Err(_) => {}
            }
        };
    }

    try_ty!(&str, |value: &str| value.to_string());
    try_ty!(bool, |value: bool| if value {
        "1".into()
    } else {
        "0".into()
    });
    try_ty!(i32, |value: i32| value.to_string());
    try_ty!(i64, |value: i64| value.to_string());
    try_ty!(u8, |value: u8| value.to_string());
    try_ty!(i16, |value: i16| value.to_string());
    try_ty!(f64, |value: f64| value.to_string());
    try_ty!(f32, |value: f32| value.to_string());
    try_ty!(rust_decimal::Decimal, |value: rust_decimal::Decimal| {
        value.to_string()
    });
    try_ty!(uuid::Uuid, |value: uuid::Uuid| value.to_string());
    try_ty!(chrono::NaiveDateTime, |value: chrono::NaiveDateTime| {
        value.format("%Y-%m-%d %H:%M:%S%.f").to_string()
    });
    try_ty!(chrono::NaiveDate, |value: chrono::NaiveDate| value
        .to_string());
    try_ty!(chrono::NaiveTime, |value: chrono::NaiveTime| {
        value.format("%H:%M:%S%.f").to_string()
    });
    try_ty!(chrono::DateTime<chrono::Utc>, |value: chrono::DateTime<
        chrono::Utc,
    >| { value.to_rfc3339() });
    try_ty!(&[u8], |bytes: &[u8]| {
        let mut hex = String::from("0x");
        for byte in bytes {
            hex.push_str(&format!("{byte:02X}"));
        }
        hex
    });

    let label = row
        .columns()
        .get(index)
        .map(|column| format!("<{:?}>", column.column_type()))
        .unwrap_or_else(|| "<unknown>".into());
    if matches!(
        row.columns().get(index).map(|column| column.column_type()),
        Some(ColumnType::Null)
    ) {
        None
    } else {
        Some(label)
    }
}

fn format_type(name: &str, max_length: i32, precision: i32, scale: i32) -> String {
    match name.to_ascii_lowercase().as_str() {
        "varchar" | "char" | "varbinary" | "binary" => {
            if max_length < 0 {
                format!("{name}(max)")
            } else {
                format!("{name}({max_length})")
            }
        }
        "nvarchar" | "nchar" => {
            if max_length < 0 {
                format!("{name}(max)")
            } else {
                format!("{name}({})", max_length / 2)
            }
        }
        "decimal" | "numeric" => format!("{name}({precision},{scale})"),
        "datetime2" | "datetimeoffset" | "time" => {
            if scale > 0 {
                format!("{name}({scale})")
            } else {
                name.to_string()
            }
        }
        _ => name.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::batch_returns_rows;

    #[test]
    fn plain_writes_keep_their_row_counts() {
        assert!(!batch_returns_rows(
            "UPDATE dbo.Lessons SET Title = N'a' WHERE Id = 1"
        ));
        assert!(!batch_returns_rows("delete from posts where id = 4"));
        assert!(!batch_returns_rows(
            "INSERT INTO posts (title) VALUES ('select me'); UPDATE posts SET title = 'x' WHERE id = 1"
        ));
    }

    #[test]
    fn queries_and_output_still_return_rows() {
        assert!(batch_returns_rows("SELECT * FROM posts"));
        assert!(batch_returns_rows(
            "UPDATE posts SET title = 'a' WHERE id = 1; SELECT id FROM posts"
        ));
        assert!(batch_returns_rows(
            "DELETE FROM posts OUTPUT deleted.id WHERE id = 1"
        ));
        assert!(!batch_returns_rows(
            "UPDATE posts SET note = 'select this' WHERE id = 1"
        ));
    }
}
