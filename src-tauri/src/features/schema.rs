use crate::model::{quote_mssql, quote_mysql, quote_pg, require_ident, EngineKind};

#[derive(Debug, Clone)]
pub struct ColumnDraft {
    pub name: String,
    pub original_name: String,
    pub data_type: String,
    pub length: u32,
    pub nullable: bool,
    pub primary_key: bool,
}

pub fn create_database_sql(engine: EngineKind, name: &str) -> Result<(String, String), String> {
    let name = require_ident(name, "Database")?;
    let sql = match engine {
        EngineKind::Mssql => format!("CREATE DATABASE {}", quote_mssql(&name)),
        EngineKind::Postgres => format!("CREATE DATABASE {}", quote_pg(&name)),
        EngineKind::Mysql => format!("CREATE DATABASE {}", quote_mysql(&name)),
    };
    let catalog = match engine {
        EngineKind::Mssql => "master",
        EngineKind::Postgres => "postgres",
        EngineKind::Mysql => "",
    };
    Ok((catalog.to_string(), sql))
}

pub fn save_table_sql(
    engine: EngineKind,
    schema: &str,
    name: &str,
    original_name: &str,
    previous: &[ColumnDraft],
    next: &[ColumnDraft],
) -> Result<Vec<String>, String> {
    let name = require_ident(name, "Table")?;
    let schema = schema_name(engine, schema)?;
    let next = checked(next)?;
    if original_name.trim().is_empty() {
        return Ok(vec![create_table(engine, &schema, &name, &next)?]);
    }
    let original = require_ident(original_name, "Table")?;
    let previous = checked(previous)?;
    let mut statements = Vec::new();
    let table = if !original.eq_ignore_ascii_case(&name) {
        statements.push(rename_table(engine, &schema, &original, &name));
        name
    } else {
        original
    };
    statements.extend(diff_columns(engine, &schema, &table, &previous, &next)?);
    Ok(statements)
}

fn checked(columns: &[ColumnDraft]) -> Result<Vec<ColumnDraft>, String> {
    if columns.is_empty() {
        return Err("Add at least one column.".into());
    }
    let mut seen = Vec::new();
    let mut rows = Vec::new();
    for column in columns {
        let name = require_ident(&column.name, "Column")?;
        if seen.iter().any(|item: &String| item.eq_ignore_ascii_case(&name)) {
            return Err(format!("Column `{name}` is listed more than once."));
        }
        seen.push(name.clone());
        let original = column.original_name.trim();
        if !original.is_empty() {
            require_ident(original, "Column")?;
        }
        rows.push(ColumnDraft {
            name,
            original_name: original.to_string(),
            data_type: normalize_type(&column.data_type),
            length: column.length,
            nullable: column.nullable,
            primary_key: column.primary_key,
        });
    }
    Ok(rows)
}

fn create_table(engine: EngineKind, schema: &str, name: &str, columns: &[ColumnDraft]) -> Result<String, String> {
    let mut lines = Vec::new();
    for column in columns {
        lines.push(column_line(engine, column)?);
    }
    let keys: Vec<String> = columns
        .iter()
        .filter(|column| column.primary_key)
        .map(|column| quote(engine, &column.name))
        .collect();
    if !keys.is_empty() {
        lines.push(format!("    PRIMARY KEY ({})", keys.join(", ")));
    }
    Ok(format!(
        "CREATE TABLE {} (\n{}\n)",
        table_ref(engine, schema, name),
        lines.join(",\n")
    ))
}

fn diff_columns(
    engine: EngineKind,
    schema: &str,
    table: &str,
    previous: &[ColumnDraft],
    next: &[ColumnDraft],
) -> Result<Vec<String>, String> {
    let mut statements = Vec::new();
    for old in previous {
        let kept = next.iter().any(|column| column.original_name.eq_ignore_ascii_case(&old.name));
        if kept {
            continue;
        }
        statements.push(format!(
            "ALTER TABLE {} DROP COLUMN {}",
            table_ref(engine, schema, table),
            quote(engine, &old.name)
        ));
    }
    for column in next {
        if column.original_name.is_empty() {
            statements.push(format!(
                "ALTER TABLE {} ADD {}",
                table_ref(engine, schema, table),
                column_line(engine, column)?.trim()
            ));
            continue;
        }
        let Some(old) = previous
            .iter()
            .find(|item| item.name.eq_ignore_ascii_case(&column.original_name))
        else {
            continue;
        };
        if !column.original_name.eq_ignore_ascii_case(&column.name) {
            statements.push(rename_column(engine, schema, table, &column.original_name, &column.name)?);
        }
        if old.data_type != column.data_type || old.length != column.length || old.nullable != column.nullable {
            statements.push(alter_column(engine, schema, table, column)?);
        }
    }
    Ok(statements)
}

fn rename_column(engine: EngineKind, schema: &str, table: &str, from: &str, to: &str) -> Result<String, String> {
    Ok(match engine {
        EngineKind::Mssql => format!(
            "EXEC sp_rename N'{}.{}.{}', N'{}', N'COLUMN'",
            schema.replace('\'', "''"),
            table.replace('\'', "''"),
            from.replace('\'', "''"),
            to.replace('\'', "''")
        ),
        EngineKind::Postgres => format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {}",
            table_ref(engine, schema, table),
            quote_pg(from),
            quote_pg(to)
        ),
        EngineKind::Mysql => format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {}",
            quote_mysql(table),
            quote_mysql(from),
            quote_mysql(to)
        ),
    })
}

fn column_line(engine: EngineKind, column: &ColumnDraft) -> Result<String, String> {
    Ok(format!(
        "    {} {} {}",
        quote(engine, &column.name),
        sql_type(engine, &column.data_type, column.length)?,
        if column.nullable { "NULL" } else { "NOT NULL" }
    ))
}

fn alter_column(engine: EngineKind, schema: &str, table: &str, column: &ColumnDraft) -> Result<String, String> {
    let typed = sql_type(engine, &column.data_type, column.length)?;
    let null_sql = if column.nullable { "NULL" } else { "NOT NULL" };
    Ok(match engine {
        EngineKind::Mssql => format!(
            "ALTER TABLE {} ALTER COLUMN {} {} {}",
            table_ref(engine, schema, table),
            quote_mssql(&column.name),
            typed,
            null_sql
        ),
        EngineKind::Postgres => format!(
            "ALTER TABLE {} ALTER COLUMN {} TYPE {}, ALTER COLUMN {} {}",
            table_ref(engine, schema, table),
            quote_pg(&column.name),
            typed,
            quote_pg(&column.name),
            if column.nullable { "DROP NOT NULL" } else { "SET NOT NULL" }
        ),
        EngineKind::Mysql => format!(
            "ALTER TABLE {} MODIFY {} {} {}",
            quote_mysql(table),
            quote_mysql(&column.name),
            typed,
            null_sql
        ),
    })
}

fn rename_table(engine: EngineKind, schema: &str, from: &str, to: &str) -> String {
    match engine {
        EngineKind::Mssql => format!(
            "EXEC sp_rename N'{}.{}', N'{}', N'OBJECT'",
            schema.replace('\'', "''"),
            from.replace('\'', "''"),
            to.replace('\'', "''")
        ),
        EngineKind::Postgres => format!(
            "ALTER TABLE {} RENAME TO {}",
            table_ref(engine, schema, from),
            quote_pg(to)
        ),
        EngineKind::Mysql => format!("RENAME TABLE {} TO {}", quote_mysql(from), quote_mysql(to)),
    }
}

fn schema_name(engine: EngineKind, schema: &str) -> Result<String, String> {
    if engine == EngineKind::Mysql {
        return Ok(String::new());
    }
    require_ident(schema, "Schema")
}

fn table_ref(engine: EngineKind, schema: &str, name: &str) -> String {
    match engine {
        EngineKind::Mssql => format!("{}.{}", quote_mssql(schema), quote_mssql(name)),
        EngineKind::Postgres => format!("{}.{}", quote_pg(schema), quote_pg(name)),
        EngineKind::Mysql => quote_mysql(name),
    }
}

fn quote(engine: EngineKind, name: &str) -> String {
    match engine {
        EngineKind::Mssql => quote_mssql(name),
        EngineKind::Postgres => quote_pg(name),
        EngineKind::Mysql => quote_mysql(name),
    }
}

fn normalize_type(data_type: &str) -> String {
    let key = data_type.trim().to_ascii_lowercase();
    if key.starts_with("character varying") {
        return "varchar".into();
    }
    if key.starts_with("timestamp") {
        return "timestamp".into();
    }
    key.split('(').next().unwrap_or("").trim().to_string()
}

fn sql_type(engine: EngineKind, data_type: &str, length: u32) -> Result<String, String> {
    let key = normalize_type(data_type);
    let sized = |name: &str| -> Result<String, String> {
        if length == 0 {
            return match (engine, name) {
                (EngineKind::Mssql, "nvarchar" | "varchar") => Ok(format!("{name}(max)")),
                (EngineKind::Postgres, "varchar") => Ok("text".into()),
                (EngineKind::Mysql, "varchar") => Ok("text".into()),
                _ => Err("Length is required for this data type.".into()),
            };
        }
        if length > 8000 {
            return Err("Length is too large.".into());
        }
        Ok(format!("{name}({length})"))
    };
    match (engine, key.as_str()) {
        (
            EngineKind::Mssql,
            "int" | "bigint" | "smallint" | "tinyint" | "bit" | "float" | "real" | "money" | "date" | "datetime"
            | "datetime2" | "time" | "uniqueidentifier",
        ) => Ok(key),
        (EngineKind::Mssql, "decimal" | "numeric") => Ok("decimal(18, 4)".into()),
        (EngineKind::Mssql, "nvarchar" | "varchar" | "nchar" | "char") => sized(&key),
        (EngineKind::Postgres, "integer" | "bigint" | "smallint" | "boolean" | "real" | "date" | "uuid" | "text") => Ok(key),
        (EngineKind::Postgres, "double precision") => Ok("double precision".into()),
        (EngineKind::Postgres, "numeric") => Ok("numeric(18, 4)".into()),
        (EngineKind::Postgres, "timestamp") => Ok("timestamp".into()),
        (EngineKind::Postgres, "varchar") => sized("varchar"),
        (EngineKind::Mysql, "int" | "bigint" | "smallint" | "tinyint" | "bit" | "float" | "double" | "date" | "datetime" | "timestamp" | "text") => {
            Ok(key.to_ascii_uppercase())
        }
        (EngineKind::Mysql, "decimal") => Ok("DECIMAL(18, 4)".into()),
        (EngineKind::Mysql, "varchar" | "char") => Ok(sized(&key)?.to_ascii_uppercase()),
        _ => Err(format!("Unsupported data type `{data_type}`.")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str, length: u32, nullable: bool, primary_key: bool) -> ColumnDraft {
        ColumnDraft {
            name: name.into(),
            original_name: name.into(),
            data_type: data_type.into(),
            length,
            nullable,
            primary_key,
        }
    }

    fn fresh(name: &str, data_type: &str, length: u32, nullable: bool, primary_key: bool) -> ColumnDraft {
        ColumnDraft {
            original_name: String::new(),
            ..column(name, data_type, length, nullable, primary_key)
        }
    }

    #[test]
    fn creates_a_database_statement() {
        let (catalog, sql) = create_database_sql(EngineKind::Mssql, "sales").unwrap();
        assert_eq!(catalog, "master");
        assert_eq!(sql, "CREATE DATABASE [sales]");
        let (_, pg) = create_database_sql(EngineKind::Postgres, "sales").unwrap();
        assert_eq!(pg, "CREATE DATABASE \"sales\"");
    }

    #[test]
    fn creates_a_table_with_a_primary_key() {
        let sql = save_table_sql(
            EngineKind::Mssql,
            "dbo",
            "people",
            "",
            &[],
            &[
                column("id", "int", 0, false, true),
                column("name", "nvarchar", 50, false, false),
            ],
        )
        .unwrap();
        assert_eq!(sql.len(), 1);
        assert!(sql[0].contains("CREATE TABLE [dbo].[people]"));
        assert!(sql[0].contains("[name] nvarchar(50) NOT NULL"));
        assert!(sql[0].contains("PRIMARY KEY ([id])"));
    }

    #[test]
    fn alters_added_and_removed_columns() {
        let sql = save_table_sql(
            EngineKind::Postgres,
            "public",
            "people",
            "people",
            &[column("id", "integer", 0, false, true), column("note", "text", 0, true, false)],
            &[
                column("id", "integer", 0, false, true),
                fresh("email", "text", 0, true, false),
            ],
        )
        .unwrap();
        assert!(sql.iter().any(|item| item.contains("DROP COLUMN \"note\"")));
        assert!(sql.iter().any(|item| item.contains("ADD     \"email\" text NULL") || item.contains("ADD \"email\"")));
    }

    #[test]
    fn rejects_an_unknown_type() {
        let error = save_table_sql(
            EngineKind::Postgres,
            "public",
            "people",
            "",
            &[],
            &[column("id", "xml", 0, false, false)],
        );
        assert!(error.is_err());
    }
}
