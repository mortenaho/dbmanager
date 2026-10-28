use serde::{Deserialize, Serialize};

pub const STORE_ROW_LIMIT: usize = 5_000;
pub const HARD_ROW_LIMIT: usize = 20_000;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EngineKind {
    Mssql,
    Postgres,
    Mysql,
}

impl EngineKind {
    pub fn default_port(self) -> u16 {
        match self {
            Self::Mssql => 1433,
            Self::Postgres => 5432,
            Self::Mysql => 3306,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Credentials {
    pub engine: EngineKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub trust_cert: bool,
    pub encrypt: bool,
    pub ssl: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub engine: EngineKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    pub database: String,
    pub trust_cert: bool,
    pub encrypt: bool,
    pub ssl: bool,
    pub remember_password: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectResponse {
    pub id: String,
    pub name: String,
    pub engine: EngineKind,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub database: String,
    pub databases: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbObject {
    pub schema: String,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnRef {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultSet {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub rows_affected: u64,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryMessage {
    pub level: String,
    pub text: String,
}

impl QueryMessage {
    pub fn info(text: impl Into<String>) -> Self {
        Self {
            level: "info".into(),
            text: text.into(),
        }
    }

    pub fn warn(text: impl Into<String>) -> Self {
        Self {
            level: "warn".into(),
            text: text.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub sql: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResponse {
    pub result_sets: Vec<ResultSet>,
    pub messages: Vec<QueryMessage>,
    pub elapsed_ms: u128,
}

#[allow(dead_code)]
pub fn quote_pg(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

pub fn quote_mssql(name: &str) -> String {
    format!("[{}]", name.replace(']', "]]"))
}

pub fn quote_mysql(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
}

pub fn default_database(engine: EngineKind, database: &str) -> String {
    let database = database.trim();
    if !database.is_empty() {
        return database.to_string();
    }
    match engine {
        EngineKind::Mssql => "master".into(),
        EngineKind::Postgres => "postgres".into(),
        EngineKind::Mysql => String::new(),
    }
}

pub fn display_name(name: &str, host: &str, port: u16) -> String {
    let name = name.trim();
    if name.is_empty() {
        format!("{host},{port}")
    } else {
        name.to_string()
    }
}

pub fn require_ident(name: &str, label: &str) -> Result<String, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err(format!("{label} is required."));
    }
    if name.len() > 128 || name.chars().any(|c| c.is_control() || c == ';') {
        return Err(format!("{label} contains invalid characters."));
    }
    Ok(name.to_string())
}

pub fn protected_database(engine: EngineKind, name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    match engine {
        EngineKind::Mssql => matches!(name.as_str(), "master" | "model" | "msdb" | "tempdb"),
        EngineKind::Postgres => matches!(name.as_str(), "template0" | "template1"),
        EngineKind::Mysql => matches!(
            name.as_str(),
            "mysql" | "information_schema" | "performance_schema" | "sys"
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_identifiers() {
        assert_eq!(quote_pg("a\"b"), "\"a\"\"b\"");
        assert_eq!(quote_mssql("a]b"), "[a]]b]");
        assert_eq!(quote_mysql("a`b"), "`a``b`");
    }

    #[test]
    fn fills_default_database() {
        assert_eq!(default_database(EngineKind::Mssql, "  "), "master");
        assert_eq!(default_database(EngineKind::Postgres, ""), "postgres");
        assert_eq!(default_database(EngineKind::Mysql, ""), "");
        assert_eq!(default_database(EngineKind::Mysql, " app "), "app");
    }

    #[test]
    fn rejects_bad_identifiers() {
        assert!(require_ident("  ", "Name").is_err());
        assert!(require_ident("a;b", "Name").is_err());
        assert_eq!(require_ident(" Orders ", "Name").unwrap(), "Orders");
        assert!(protected_database(EngineKind::Mssql, "master"));
        assert!(!protected_database(EngineKind::Postgres, "postgres"));
        assert!(protected_database(EngineKind::Mysql, "information_schema"));
    }
}
