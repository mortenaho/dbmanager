use crate::model::{EngineKind, quote_mssql, quote_mysql, quote_pg};

pub const SCRIPT_ROW_LIMIT: usize = 5_000;

pub struct TableData {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub truncated: bool,
}

#[derive(Debug, Clone)]
pub struct ScriptColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_sql: Option<String>,
    pub identity: bool,
}

pub fn qualify(engine: EngineKind, schema: &str, name: &str) -> String {
    match engine {
        EngineKind::Mysql => quote_mysql(name),
        EngineKind::Postgres => format!("{}.{}", quote_pg(schema), quote_pg(name)),
        EngineKind::Mssql => format!("{}.{}", quote_mssql(schema), quote_mssql(name)),
    }
}

pub fn quote_ident(engine: EngineKind, name: &str) -> String {
    match engine {
        EngineKind::Mysql => quote_mysql(name),
        EngineKind::Postgres => quote_pg(name),
        EngineKind::Mssql => quote_mssql(name),
    }
}

pub fn sql_value(engine: EngineKind, value: Option<&str>) -> String {
    let Some(value) = value else {
        return "NULL".into();
    };
    match engine {
        EngineKind::Mssql => format!("N'{}'", value.replace('\'', "''")),
        EngineKind::Postgres => format!("'{}'", value.replace('\'', "''")),
        EngineKind::Mysql => format!("'{}'", value.replace('\\', "\\\\").replace('\'', "''")),
    }
}

pub fn create_table_sql(
    engine: EngineKind,
    schema: &str,
    table: &str,
    columns: &[ScriptColumn],
    primary_key: &[String],
) -> String {
    let mut lines = Vec::new();
    for column in columns {
        let mut line = format!(
            "    {} {}",
            quote_ident(engine, &column.name),
            if column.data_type.is_empty() {
                "text".into()
            } else {
                column.data_type.clone()
            }
        );
        if column.identity && engine == EngineKind::Mssql {
            line.push_str(" IDENTITY(1,1)");
        }
        if !column.nullable {
            line.push_str(" NOT NULL");
        }
        if let Some(default_sql) = column
            .default_sql
            .as_ref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
        {
            line.push_str(" DEFAULT ");
            line.push_str(default_sql);
        }
        lines.push(line);
    }
    if !primary_key.is_empty() {
        let keys = primary_key
            .iter()
            .map(|name| quote_ident(engine, name))
            .collect::<Vec<_>>()
            .join(", ");
        lines.push(format!("    PRIMARY KEY ({keys})"));
    }
    format!(
        "CREATE TABLE {} (\n{}\n);",
        qualify(engine, schema, table),
        lines.join(",\n")
    )
}

pub fn insert_sql(
    engine: EngineKind,
    schema: &str,
    table: &str,
    columns: &[String],
    rows: &[Vec<Option<String>>],
    identity_insert: bool,
) -> String {
    if columns.is_empty() || rows.is_empty() {
        return String::new();
    }
    let qualified = qualify(engine, schema, table);
    let names = columns
        .iter()
        .map(|name| quote_ident(engine, name))
        .collect::<Vec<_>>()
        .join(", ");
    let mut sql = String::new();
    if identity_insert && engine == EngineKind::Mssql {
        sql.push_str(&format!("SET IDENTITY_INSERT {qualified} ON;\n"));
    }
    for chunk in rows.chunks(40) {
        sql.push_str(&format!("INSERT INTO {qualified} ({names})\nVALUES\n"));
        for (index, row) in chunk.iter().enumerate() {
            let values = columns
                .iter()
                .enumerate()
                .map(|(column_index, _)| {
                    sql_value(
                        engine,
                        row.get(column_index).and_then(|value| value.as_deref()),
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str("    (");
            sql.push_str(&values);
            sql.push(')');
            if index + 1 == chunk.len() {
                sql.push_str(";\n");
            } else {
                sql.push_str(",\n");
            }
        }
    }
    if identity_insert && engine == EngineKind::Mssql {
        sql.push_str(&format!("SET IDENTITY_INSERT {qualified} OFF;\n"));
    }
    sql
}

pub fn script_header(database: &str, include_data: bool) -> String {
    let kind = if include_data { "backup" } else { "script" };
    format!(
        "-- DB Manager {kind} of {database}\n-- Row data is limited to {SCRIPT_ROW_LIMIT} rows per table.\n\n"
    )
}

pub fn create_database_sql(engine: EngineKind, database: &str) -> Option<String> {
    let database = database.trim();
    if database.is_empty() {
        return None;
    }
    match engine {
        EngineKind::Postgres => {
            // PostgreSQL cannot CREATE DATABASE inside a DO block; emit CREATE for empty servers.
            Some(format!(
                "-- Run while connected to postgres/template1 if the database is missing.\nCREATE DATABASE {};\n",
                quote_pg(database)
            ))
        }
        EngineKind::Mysql => Some(format!(
            "CREATE DATABASE IF NOT EXISTS {};\nUSE {};\n",
            quote_mysql(database),
            quote_mysql(database)
        )),
        EngineKind::Mssql => {
            let quoted = quote_mssql(database);
            Some(format!(
                "IF DB_ID(N'{}') IS NULL\n    CREATE DATABASE {quoted};\nGO\nUSE {quoted};\nGO\n",
                database.replace('\'', "''")
            ))
        }
    }
}

pub fn create_schema_sql(engine: EngineKind, schema: &str) -> Option<String> {
    let schema = schema.trim();
    if schema.is_empty() {
        return None;
    }
    match engine {
        EngineKind::Mysql => None,
        EngineKind::Postgres => {
            if schema.eq_ignore_ascii_case("public") {
                return None;
            }
            Some(format!(
                "CREATE SCHEMA IF NOT EXISTS {};\n",
                quote_pg(schema)
            ))
        }
        EngineKind::Mssql => {
            if schema.eq_ignore_ascii_case("dbo")
                || schema.eq_ignore_ascii_case("guest")
                || schema.eq_ignore_ascii_case("sys")
                || schema.eq_ignore_ascii_case("INFORMATION_SCHEMA")
            {
                return None;
            }
            let quoted = quote_mssql(schema);
            let literal = schema.replace('\'', "''");
            Some(format!(
                "IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = N'{literal}')\n    EXEC(N'CREATE SCHEMA {quoted}');\nGO\n"
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_text_and_nulls() {
        assert_eq!(sql_value(EngineKind::Postgres, None), "NULL");
        assert_eq!(sql_value(EngineKind::Postgres, Some("a'b")), "'a''b'");
        assert_eq!(sql_value(EngineKind::Mssql, Some("a'b")), "N'a''b'");
        assert_eq!(sql_value(EngineKind::Mysql, Some("a\\b")), "'a\\\\b'");
    }

    #[test]
    fn builds_create_and_insert() {
        let columns = vec![ScriptColumn {
            name: "id".into(),
            data_type: "integer".into(),
            nullable: false,
            default_sql: None,
            identity: false,
        }];
        let create = create_table_sql(
            EngineKind::Postgres,
            "public",
            "orders",
            &columns,
            &["id".into()],
        );
        assert!(create.contains("CREATE TABLE \"public\".\"orders\""));
        assert!(create.contains("PRIMARY KEY (\"id\")"));
        let insert = insert_sql(
            EngineKind::Postgres,
            "public",
            "orders",
            &["id".into()],
            &[vec![Some("1".into())]],
            false,
        );
        assert!(insert.starts_with("INSERT INTO \"public\".\"orders\" (\"id\")"));
        assert!(insert.contains("('1')"));
    }
}
