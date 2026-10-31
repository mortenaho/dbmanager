pub(crate) mod backup;
pub(crate) mod guard;
mod mssql;
mod mysql;
mod postgres;
mod script;

use std::collections::HashMap;

use crate::model::{
    ColumnInfo, ColumnRef, Credentials, DbObject, EngineKind, QueryResponse, ResultSet,
    ScriptResult, protected_database, quote_mssql, quote_mysql, quote_pg, require_ident,
};

pub enum EngineConn {
    Postgres(HashMap<String, tokio_postgres::Client>),
    Mysql(mysql_async::Conn),
    Mssql(mssql::MssqlClient),
    Closed,
}

pub enum Outcome {
    Done {
        response: QueryResponse,
        drop_connection: bool,
    },
    Failed {
        message: String,
        drop_connection: bool,
    },
}

pub async fn open(creds: &Credentials) -> Result<EngineConn, String> {
    match creds.engine {
        EngineKind::Postgres => {
            let database = postgres_db(creds, &creds.database);
            let client = postgres::connect(creds, database).await?;
            let mut clients = HashMap::new();
            clients.insert(database.to_string(), client);
            Ok(EngineConn::Postgres(clients))
        }
        EngineKind::Mysql => Ok(EngineConn::Mysql(
            mysql::connect(creds, &creds.database).await?,
        )),
        EngineKind::Mssql => Ok(EngineConn::Mssql(
            mssql::connect(creds, &creds.database).await?,
        )),
    }
}

pub async fn list_databases(
    conn: &mut EngineConn,
    creds: &Credentials,
) -> Result<Vec<String>, String> {
    ensure_open(conn, creds).await?;
    match conn {
        EngineConn::Postgres(clients) => {
            let database = postgres_db(creds, &creds.database);
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::list_databases(client).await
        }
        EngineConn::Mysql(conn) => mysql::list_databases(conn).await,
        EngineConn::Mssql(client) => mssql::list_databases(client).await,
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn list_objects(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
) -> Result<Vec<DbObject>, String> {
    if database.is_empty() {
        return Err("Choose a database first.".into());
    }
    ensure_open(conn, creds).await?;
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::list_objects(client).await
        }
        EngineConn::Mysql(conn) => mysql::list_objects(conn, database).await,
        EngineConn::Mssql(client) => mssql::list_objects(client, database).await,
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn list_columns(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    table: &str,
) -> Result<Vec<ColumnInfo>, String> {
    if database.is_empty() {
        return Err("Choose a database first.".into());
    }
    ensure_open(conn, creds).await?;
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::list_columns(client, schema, table).await
        }
        EngineConn::Mysql(conn) => mysql::list_columns(conn, database, table).await,
        EngineConn::Mssql(client) => mssql::list_columns(client, database, schema, table).await,
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn list_all_columns(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
) -> Result<Vec<ColumnRef>, String> {
    if database.is_empty() {
        return Err("Choose a database first.".into());
    }
    ensure_open(conn, creds).await?;
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::list_all_columns(client).await
        }
        EngineConn::Mysql(conn) => mysql::list_all_columns(conn, database).await,
        EngineConn::Mssql(client) => mssql::list_all_columns(client, database).await,
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn rename_object(
    conn: &mut EngineConn,
    creds: &Credentials,
    kind: &str,
    database: &str,
    schema: &str,
    name: &str,
    new_name: &str,
) -> Result<String, String> {
    let new_name = require_ident(new_name, "New name")?;
    ensure_open(conn, creds).await?;
    match kind {
        "database" => {
            let database = require_ident(database, "Database")?;
            if protected_database(creds.engine, &database) {
                return Err(format!(
                    "`{database}` is a system database and cannot be renamed."
                ));
            }
            if database.eq_ignore_ascii_case(&new_name) {
                return Err("Choose a different name.".into());
            }
            rename_database(conn, creds, &database, &new_name).await
        }
        "table" => {
            if database.is_empty() {
                return Err("Choose a database first.".into());
            }
            let name = require_ident(name, "Object")?;
            if name.eq_ignore_ascii_case(&new_name) {
                return Err("Choose a different name.".into());
            }
            let schema = if schema.trim().is_empty() {
                match creds.engine {
                    EngineKind::Postgres => "public",
                    EngineKind::Mssql => "dbo",
                    EngineKind::Mysql => database,
                }
            } else {
                schema.trim()
            };
            rename_table(conn, creds, database, schema, &name, &new_name).await?;
            Ok("Object renamed.".into())
        }
        _ => Err("Choose a database or a table.".into()),
    }
}

async fn rename_database(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    new_name: &str,
) -> Result<String, String> {
    match conn {
        EngineConn::Postgres(clients) => {
            clients.remove(database);
            let admin = if database.eq_ignore_ascii_case("postgres") {
                "template1"
            } else {
                "postgres"
            };
            let client = match postgres::ensure(clients, creds, admin).await {
                Ok(client) => client,
                Err(error) if admin != "template1" => postgres::ensure(clients, creds, "template1")
                    .await
                    .map_err(|_| error)?,
                Err(error) => return Err(error),
            };
            postgres::rename_database(client, database, new_name).await?;
            Ok("Database renamed.".into())
        }
        EngineConn::Mysql(conn) => mysql::rename_database(conn, database, new_name).await,
        EngineConn::Mssql(client) => {
            mssql::use_database(client, "master").await?;
            mssql::rename_database(client, database, new_name).await?;
            Ok("Database renamed.".into())
        }
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

async fn rename_table(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    name: &str,
    new_name: &str,
) -> Result<(), String> {
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::rename_relation(client, schema, name, new_name).await
        }
        EngineConn::Mysql(conn) => mysql::rename_table(conn, database, name, new_name).await,
        EngineConn::Mssql(client) => {
            mssql::use_database(client, database).await?;
            mssql::rename_relation(client, schema, name, new_name).await
        }
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn script_routine(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    name: &str,
    kind: &str,
) -> Result<String, String> {
    if database.is_empty() {
        return Err("Choose a database first.".into());
    }
    let name = require_ident(name, "Routine")?;
    ensure_open(conn, creds).await?;
    let schema = if schema.trim().is_empty() {
        match creds.engine {
            EngineKind::Postgres => "public".to_string(),
            EngineKind::Mssql => "dbo".to_string(),
            EngineKind::Mysql => database.to_string(),
        }
    } else {
        schema.trim().to_string()
    };
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::script_routine(client, &schema, &name, kind).await
        }
        EngineConn::Mysql(conn) => mysql::script_routine(conn, database, &name, kind).await,
        EngineConn::Mssql(client) => mssql::script_routine(client, database, &schema, &name).await,
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn generate_script(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    name: &str,
    kind: &str,
    include_create: bool,
    include_data: bool,
) -> Result<ScriptResult, String> {
    if database.is_empty() {
        return Err("Choose a database first.".into());
    }
    if !include_create && !include_data {
        return Err("Choose a script to generate.".into());
    }
    ensure_open(conn, creds).await?;
    match conn {
        EngineConn::Mysql(conn) => mysql::use_database(conn, database).await?,
        EngineConn::Mssql(client) => mssql::use_database(client, database).await?,
        EngineConn::Postgres(_) | EngineConn::Closed => {}
    }
    if matches!(conn, EngineConn::Closed) {
        return Err("Connection is closed.".into());
    }

    let mut sql = script::script_header(database, include_data);
    let mut warnings = Vec::new();
    if kind == "database" {
        let objects = list_objects(conn, creds, database).await?;
        for object in objects {
            match script_object(conn, creds, database, &object, include_create, include_data).await
            {
                Ok((chunk, notes)) => {
                    sql.push_str(&chunk);
                    warnings.extend(notes);
                }
                Err(error) => {
                    warnings.push(format!("{}.{}: {error}", object.schema, object.name));
                    sql.push_str(&format!(
                        "-- skipped {}.{}: {error}\n\n",
                        object.schema, object.name
                    ));
                }
            }
        }
    } else {
        let schema = if schema.trim().is_empty() {
            match creds.engine {
                EngineKind::Postgres => "public".to_string(),
                EngineKind::Mssql => "dbo".to_string(),
                EngineKind::Mysql => database.to_string(),
            }
        } else {
            schema.trim().to_string()
        };
        let name = require_ident(name, "Object")?;
        let object = crate::model::DbObject::plain(schema, name, kind);
        let (chunk, notes) =
            script_object(conn, creds, database, &object, include_create, include_data).await?;
        sql.push_str(&chunk);
        warnings.extend(notes);
    }
    if sql.trim().is_empty() {
        return Err("Nothing was scripted.".into());
    }
    Ok(ScriptResult { sql, warnings })
}

async fn script_object(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    object: &DbObject,
    include_create: bool,
    include_data: bool,
) -> Result<(String, Vec<String>), String> {
    let mut sql = String::new();
    let mut warnings = Vec::new();
    match object.kind.as_str() {
        "table" => {
            if include_create {
                sql.push_str(
                    &create_table_sql(conn, creds, database, &object.schema, &object.name).await?,
                );
                sql.push_str("\n\n");
            }
            if include_data {
                let identity_insert =
                    mssql_identity(conn, database, &object.schema, &object.name).await;
                let data = fetch_rows(conn, creds, database, &object.schema, &object.name).await?;
                if data.truncated {
                    let note = format!(
                        "{}.{} was limited to {} rows.",
                        object.schema,
                        object.name,
                        script::SCRIPT_ROW_LIMIT
                    );
                    warnings.push(note.clone());
                    sql.push_str(&format!("-- {note}\n"));
                }
                sql.push_str(&script::insert_sql(
                    creds.engine,
                    &object.schema,
                    &object.name,
                    &data.columns,
                    &data.rows,
                    identity_insert,
                ));
                sql.push('\n');
            }
        }
        "view" if include_create => {
            if creds.engine == EngineKind::Mssql {
                sql.push_str("GO\n");
            }
            sql.push_str(
                &create_view_sql(conn, creds, database, &object.schema, &object.name).await?,
            );
            sql.push_str("\n\n");
            if creds.engine == EngineKind::Mssql {
                sql.push_str("GO\n\n");
            }
        }
        "procedure" | "function" if include_create => {
            let body = script_routine(
                conn,
                creds,
                database,
                &object.schema,
                &object.name,
                &object.kind,
            )
            .await?;
            match creds.engine {
                EngineKind::Mssql => sql.push_str(&format!("GO\n{body}\nGO\n\n")),
                EngineKind::Mysql => {
                    sql.push_str(&format!("DELIMITER $$\n{body}\n$$\nDELIMITER ;\n\n"))
                }
                EngineKind::Postgres => sql.push_str(&format!("{body};\n\n")),
            }
        }
        _ => {}
    }
    Ok((sql, warnings))
}

async fn mssql_identity(conn: &mut EngineConn, database: &str, schema: &str, name: &str) -> bool {
    let EngineConn::Mssql(client) = conn else {
        return false;
    };
    match mssql::script_table(client, database, schema, name).await {
        Ok((columns, _)) => columns.iter().any(|column| column.identity),
        Err(_) => false,
    }
}

async fn create_table_sql(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    name: &str,
) -> Result<String, String> {
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            let (columns, primary_key) = postgres::script_table(client, schema, name).await?;
            Ok(script::create_table_sql(
                EngineKind::Postgres,
                schema,
                name,
                &columns,
                &primary_key,
            ))
        }
        EngineConn::Mysql(conn) => mysql::script_create(conn, database, name, "table").await,
        EngineConn::Mssql(client) => {
            let (columns, primary_key) =
                mssql::script_table(client, database, schema, name).await?;
            Ok(script::create_table_sql(
                EngineKind::Mssql,
                schema,
                name,
                &columns,
                &primary_key,
            ))
        }
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

async fn create_view_sql(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    name: &str,
) -> Result<String, String> {
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::script_view(client, schema, name).await
        }
        EngineConn::Mysql(conn) => mysql::script_create(conn, database, name, "view").await,
        EngineConn::Mssql(client) => mssql::script_routine(client, database, schema, name).await,
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

async fn fetch_rows(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    schema: &str,
    name: &str,
) -> Result<script::TableData, String> {
    match conn {
        EngineConn::Postgres(clients) => {
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::fetch_rows(client, schema, name, script::SCRIPT_ROW_LIMIT).await
        }
        EngineConn::Mysql(conn) => {
            mysql::fetch_rows(conn, database, name, script::SCRIPT_ROW_LIMIT).await
        }
        EngineConn::Mssql(client) => {
            mssql::fetch_rows(client, schema, name, script::SCRIPT_ROW_LIMIT).await
        }
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

pub async fn execute(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    sql: &str,
    max_rows: usize,
) -> Result<QueryResponse, String> {
    execute_on(conn, creds, database, sql, max_rows, true).await
}

pub async fn execute_on(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    sql: &str,
    max_rows: usize,
    switch_database: bool,
) -> Result<QueryResponse, String> {
    ensure_open(conn, creds).await?;
    let outcome = match conn {
        EngineConn::Postgres(clients) => {
            let database = postgres_db(creds, database);
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::execute(client, sql, max_rows).await
        }
        EngineConn::Mysql(inner) => {
            if switch_database {
                mysql::use_database(inner, database).await?;
            }
            mysql::execute(inner, sql, max_rows).await
        }
        EngineConn::Mssql(client) => {
            if switch_database {
                mssql::use_database(client, database).await?;
            }
            mssql::execute(client, sql, max_rows).await
        }
        EngineConn::Closed => {
            return Err("Connection is closed.".into());
        }
    };
    apply(conn, outcome)
}

pub async fn capture_backup(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    plan: &backup::WritePlan,
    lock: bool,
) -> Result<backup::RowBackup, String> {
    let sql = backup::snapshot_sql(creds.engine, plan, lock);
    let response = execute_on(conn, creds, database, &sql, backup::MAX_BACKUP_ROWS, !lock)
        .await
        .map_err(|error| {
            format!(
                "Could not back up rows before {}. {error}\n\nThe statement was not run.",
                plan.kind.label()
            )
        })?;
    let set = response
        .result_sets
        .into_iter()
        .find(|set| !set.columns.is_empty())
        .unwrap_or(ResultSet {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: 0,
            truncated: false,
        });
    if set.truncated || set.rows.len() > backup::MAX_BACKUP_ROWS {
        return Err(backup::too_many_rows_message(plan.kind, &plan.preview));
    }
    if backup::payload_bytes(&set.rows) > backup::MAX_BACKUP_BYTES {
        return Err(backup::too_large_message(plan.kind, &plan.preview));
    }
    let (table_sql, catalog) = backup_target(conn, creds, database, &plan.table_parts).await?;
    let key_columns = catalog
        .iter()
        .filter(|column| column.primary_key)
        .filter_map(|column| named(&set.columns, &column.name))
        .collect::<Vec<_>>();
    if plan.kind == backup::WriteKind::Update && !set.rows.is_empty() && key_columns.is_empty() {
        return Err(format!(
            "This UPDATE on {table_sql} cannot be rolled back because the table has no primary key. The statement was not run.\n\n{}",
            plan.preview
        ));
    }
    if plan.kind == backup::WriteKind::Update {
        if let Some(column) = key_columns.iter().find(|key| {
            plan.set_columns
                .iter()
                .any(|assigned| assigned.eq_ignore_ascii_case(key))
        }) {
            return Err(format!(
                "This UPDATE changes the primary key column {column}, so a later rollback could not find the rows. The statement was not run.\n\n{}",
                plan.preview
            ));
        }
    }
    let write_columns = set
        .columns
        .iter()
        .filter(|name| match plan.kind {
            backup::WriteKind::Delete => !flagged(&catalog, name, |column| column.generated),
            backup::WriteKind::Update => {
                !key_columns.iter().any(|key| key.eq_ignore_ascii_case(name))
                    && !flagged(&catalog, name, |column| column.generated || column.identity)
            }
        })
        .cloned()
        .collect::<Vec<_>>();
    let identity_insert = creds.engine == EngineKind::Mssql
        && plan.kind == backup::WriteKind::Delete
        && write_columns
            .iter()
            .any(|name| flagged(&catalog, name, |column| column.identity));
    let overriding_system = creds.engine == EngineKind::Postgres
        && plan.kind == backup::WriteKind::Delete
        && write_columns
            .iter()
            .any(|name| flagged(&catalog, name, |column| column.identity_always));
    Ok(backup::RowBackup {
        statement_index: plan.statement_index,
        kind: plan.kind,
        table_sql,
        columns: set.columns,
        rows: set.rows,
        key_columns,
        write_columns,
        identity_insert,
        overriding_system,
    })
}

async fn backup_target(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    parts: &[String],
) -> Result<(String, Vec<backup::BackupColumn>), String> {
    match conn {
        EngineConn::Postgres(clients) => {
            let database = postgres_db(creds, database);
            let client = postgres::ensure(clients, creds, database).await?;
            let (schema, table) = postgres::resolve_backup_table(client, parts).await?;
            let columns = postgres::backup_columns(client, &schema, &table).await?;
            Ok((
                format!("{}.{}", quote_pg(&schema), quote_pg(&table)),
                columns,
            ))
        }
        EngineConn::Mysql(inner) => {
            let (schema, table) = match parts {
                [table] => (database.to_string(), table.clone()),
                [schema, table] => (schema.clone(), table.clone()),
                _ => {
                    return Err("MySQL backups support database.table names only. The statement was not run.".into());
                }
            };
            if schema.is_empty() {
                return Err("Choose a database before updating or deleting rows. The statement was not run.".into());
            }
            let columns = mysql::backup_columns(inner, &schema, &table).await?;
            Ok((
                format!("{}.{}", quote_mysql(&schema), quote_mysql(&table)),
                columns,
            ))
        }
        EngineConn::Mssql(client) => {
            let (db, schema, table) = match parts {
                [table] => (database.to_string(), None, table.clone()),
                [schema, table] => (database.to_string(), Some(schema.clone()), table.clone()),
                [db, schema, table] => (db.clone(), Some(schema.clone()), table.clone()),
                _ => {
                    return Err(
                        "SQL Server backups support database.schema.table names only. The statement was not run."
                            .into(),
                    );
                }
            };
            if db.is_empty() {
                return Err("Choose a database before updating or deleting rows. The statement was not run.".into());
            }
            let (schema_name, table_name, columns) =
                mssql::backup_columns(client, &db, schema.as_deref(), &table).await?;
            Ok((
                format!(
                    "{}.{}.{}",
                    quote_mssql(&db),
                    quote_mssql(&schema_name),
                    quote_mssql(&table_name)
                ),
                columns,
            ))
        }
        EngineConn::Closed => Err("Connection is closed.".into()),
    }
}

fn named(columns: &[String], name: &str) -> Option<String> {
    columns
        .iter()
        .find(|column| column.eq_ignore_ascii_case(name))
        .cloned()
}

fn flagged(
    catalog: &[backup::BackupColumn],
    name: &str,
    flag: impl Fn(&backup::BackupColumn) -> bool,
) -> bool {
    catalog
        .iter()
        .any(|column| column.name.eq_ignore_ascii_case(name) && flag(column))
}

pub async fn parse(
    conn: &mut EngineConn,
    creds: &Credentials,
    database: &str,
    sql: &str,
) -> Result<QueryResponse, String> {
    ensure_open(conn, creds).await?;
    let outcome = match conn {
        EngineConn::Postgres(clients) => {
            let database = postgres_db(creds, database);
            let client = postgres::ensure(clients, creds, database).await?;
            postgres::parse(client, sql).await
        }
        EngineConn::Mysql(conn) => {
            mysql::use_database(conn, database).await?;
            mysql::parse(conn, sql).await
        }
        EngineConn::Mssql(client) => {
            mssql::use_database(client, database).await?;
            mssql::parse(client, sql).await
        }
        EngineConn::Closed => {
            return Err("Connection is closed.".into());
        }
    };
    apply(conn, outcome)
}

async fn ensure_open(conn: &mut EngineConn, creds: &Credentials) -> Result<(), String> {
    if matches!(conn, EngineConn::Closed) {
        *conn = open(creds).await?;
    }
    Ok(())
}

fn apply(conn: &mut EngineConn, outcome: Outcome) -> Result<QueryResponse, String> {
    match outcome {
        Outcome::Done {
            response,
            drop_connection,
        } => {
            if drop_connection {
                *conn = EngineConn::Closed;
            }
            Ok(response)
        }
        Outcome::Failed {
            message,
            drop_connection,
        } => {
            if drop_connection {
                *conn = EngineConn::Closed;
            }
            Err(message)
        }
    }
}

fn postgres_db<'a>(creds: &'a Credentials, database: &'a str) -> &'a str {
    if !database.is_empty() {
        database
    } else if !creds.database.is_empty() {
        creds.database.as_str()
    } else {
        "postgres"
    }
}
