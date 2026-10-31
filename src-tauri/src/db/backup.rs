use crate::model::{EngineKind, quote_mssql, quote_mysql, quote_pg};

pub const MAX_BACKUP_ROWS: usize = 5_000;
pub const MAX_BACKUP_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WriteKind {
    Update,
    Delete,
}

impl WriteKind {
    pub fn label(self) -> &'static str {
        match self {
            Self::Update => "UPDATE",
            Self::Delete => "DELETE",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WritePlan {
    pub kind: WriteKind,
    pub preview: String,
    pub table_raw: String,
    pub table_parts: Vec<String>,
    pub only: bool,
    pub alias_sql: String,
    pub where_sql: String,
    pub with_sql: String,
    pub set_columns: Vec<String>,
    pub statement_index: usize,
}

#[derive(Debug, Clone)]
pub struct BackupColumn {
    pub name: String,
    pub primary_key: bool,
    pub identity: bool,
    pub identity_always: bool,
    pub generated: bool,
}

#[derive(Debug, Clone)]
pub struct RowBackup {
    pub statement_index: usize,
    pub kind: WriteKind,
    pub table_sql: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
    pub key_columns: Vec<String>,
    pub write_columns: Vec<String>,
    pub identity_insert: bool,
    pub overriding_system: bool,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum TokenKind {
    Word,
    Ident,
    String,
    Open,
    Close,
    Comma,
    Dot,
    Semi,
    Eq,
    Other,
}

#[derive(Clone)]
struct Token {
    kind: TokenKind,
    start: usize,
    end: usize,
    text: String,
}

pub fn plan_writes(engine: EngineKind, sql: &str) -> Result<Vec<WritePlan>, String> {
    let tokens = lex(sql);
    let mut writes = Vec::new();
    let mut problems = Vec::new();
    for (index, (start, end)) in statement_ranges(sql, &tokens).into_iter().enumerate() {
        match parse_statement(engine, sql, &tokens, start, end, index) {
            Ok(Some(plan)) => writes.push(plan),
            Ok(None) => {}
            Err(message) => problems.push(message),
        }
    }
    if problems.is_empty() {
        Ok(writes)
    } else {
        problems.push("Run a single-table UPDATE or DELETE with a WHERE clause.".into());
        Err(problems.join("\n\n"))
    }
}

pub fn batch_controls_transaction(sql: &str) -> bool {
    let tokens = lex(sql);
    let mut depth = 0i32;
    for token in &tokens {
        match token.kind {
            TokenKind::Open => depth += 1,
            TokenKind::Close => depth -= 1,
            TokenKind::Word if depth == 0 && is_txn_word(&token.text) => return true,
            _ => {}
        }
    }
    false
}

pub fn snapshot_sql(engine: EngineKind, plan: &WritePlan, lock: bool) -> String {
    let limit = MAX_BACKUP_ROWS + 1;
    let only = if plan.only { "ONLY " } else { "" };
    let from = format!("{only}{}{}", plan.table_raw, plan.alias_sql);
    let filter = plan.where_sql.trim();
    let body = match engine {
        EngineKind::Mssql => {
            let hint = if lock {
                " WITH (UPDLOCK, HOLDLOCK)"
            } else {
                ""
            };
            format!("SELECT TOP ({limit}) * FROM {from}{hint} WHERE {filter}")
        }
        EngineKind::Postgres => {
            let lock_sql = if lock { " FOR UPDATE" } else { "" };
            format!("SELECT * FROM {from} WHERE {filter} LIMIT {limit}{lock_sql}")
        }
        EngineKind::Mysql => {
            let lock_sql = if lock { " FOR UPDATE" } else { "" };
            format!("SELECT * FROM {from} WHERE {filter} LIMIT {limit}{lock_sql}")
        }
    };
    if plan.with_sql.trim().is_empty() {
        body
    } else {
        format!("{} {body}", plan.with_sql.trim())
    }
}

pub fn summary(backups: &[RowBackup]) -> String {
    if backups.is_empty() {
        return String::new();
    }
    let parts = backups
        .iter()
        .map(|backup| {
            format!(
                "{} {} ({} rows)",
                backup.kind.label(),
                backup.table_sql,
                backup.rows.len()
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "Backed up rows before {parts}. Open History and choose Roll back if this was a mistake."
    )
}

pub fn too_many_rows_message(kind: WriteKind, preview: &str) -> String {
    format!(
        "This {kind} would change more than {MAX_BACKUP_ROWS} rows, so no backup was stored and the statement was not run. Narrow the WHERE clause.\n\n{preview}",
        kind = kind.label()
    )
}

pub fn too_large_message(kind: WriteKind, preview: &str) -> String {
    let mb = MAX_BACKUP_BYTES / (1024 * 1024);
    format!(
        "The backup of this {kind} would exceed {mb} MB, so the statement was not run. Narrow the WHERE clause.\n\n{preview}",
        kind = kind.label()
    )
}

pub fn payload_bytes(rows: &[Vec<Option<String>>]) -> usize {
    serde_json::to_vec(rows)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

pub fn restore_statements(engine: EngineKind, backups: &[RowBackup]) -> Vec<String> {
    let mut statements = Vec::new();
    for backup in backups {
        match backup.kind {
            WriteKind::Delete => {
                if backup.rows.is_empty() || backup.write_columns.is_empty() {
                    continue;
                }
                if backup.identity_insert {
                    statements.push(format!("SET IDENTITY_INSERT {} ON", backup.table_sql));
                }
                let columns = backup
                    .write_columns
                    .iter()
                    .map(|name| quote_ident(engine, name))
                    .collect::<Vec<_>>()
                    .join(", ");
                let indexes = backup
                    .write_columns
                    .iter()
                    .map(|name| column_index(&backup.columns, name))
                    .collect::<Vec<_>>();
                for chunk in backup.rows.chunks(100) {
                    let values = chunk
                        .iter()
                        .map(|row| {
                            let cells = indexes
                                .iter()
                                .map(|index| {
                                    let value =
                                        index.and_then(|index| row.get(index)).cloned().flatten();
                                    sql_literal(engine, value.as_deref())
                                })
                                .collect::<Vec<_>>()
                                .join(", ");
                            format!("({cells})")
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    let overriding = if backup.overriding_system {
                        " OVERRIDING SYSTEM VALUE"
                    } else {
                        ""
                    };
                    statements.push(format!(
                        "INSERT INTO {} ({columns}){overriding} VALUES {values}",
                        backup.table_sql
                    ));
                }
                if backup.identity_insert {
                    statements.push(format!("SET IDENTITY_INSERT {} OFF", backup.table_sql));
                }
            }
            WriteKind::Update => {
                if backup.key_columns.is_empty() {
                    continue;
                }
                let key_indexes = backup
                    .key_columns
                    .iter()
                    .map(|name| column_index(&backup.columns, name))
                    .collect::<Vec<_>>();
                let write_indexes = backup
                    .write_columns
                    .iter()
                    .map(|name| column_index(&backup.columns, name))
                    .collect::<Vec<_>>();
                for row in &backup.rows {
                    if backup.write_columns.is_empty() {
                        continue;
                    }
                    let assignments = backup
                        .write_columns
                        .iter()
                        .zip(&write_indexes)
                        .map(|(name, index)| {
                            let value = index.and_then(|index| row.get(index)).cloned().flatten();
                            format!(
                                "{} = {}",
                                quote_ident(engine, name),
                                sql_literal(engine, value.as_deref())
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    let predicate = backup
                        .key_columns
                        .iter()
                        .zip(&key_indexes)
                        .map(|(name, index)| {
                            let value = index.and_then(|index| row.get(index)).cloned().flatten();
                            match value {
                                Some(value) => format!(
                                    "{} = {}",
                                    quote_ident(engine, name),
                                    sql_literal(engine, Some(&value))
                                ),
                                None => format!("{} IS NULL", quote_ident(engine, name)),
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    statements.push(format!(
                        "UPDATE {} SET {assignments} WHERE {predicate}",
                        backup.table_sql
                    ));
                }
            }
        }
    }
    statements
}

pub fn begin_sql(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Postgres => "BEGIN",
        EngineKind::Mysql => "START TRANSACTION",
        EngineKind::Mssql => "BEGIN TRANSACTION",
    }
}

pub fn begin_restore_sql(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Mssql => "SET XACT_ABORT ON; BEGIN TRANSACTION",
        _ => begin_sql(engine),
    }
}

pub fn commit_sql(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Mssql => "COMMIT TRANSACTION",
        _ => "COMMIT",
    }
}

pub fn rollback_sql(engine: EngineKind) -> &'static str {
    match engine {
        EngineKind::Mssql => "ROLLBACK TRANSACTION",
        _ => "ROLLBACK",
    }
}

pub fn quote_ident(engine: EngineKind, name: &str) -> String {
    match engine {
        EngineKind::Mssql => quote_mssql(name),
        EngineKind::Postgres => quote_pg(name),
        EngineKind::Mysql => quote_mysql(name),
    }
}

fn column_index(columns: &[String], name: &str) -> Option<usize> {
    columns
        .iter()
        .position(|column| column.eq_ignore_ascii_case(name))
}

fn sql_literal(engine: EngineKind, value: Option<&str>) -> String {
    let Some(value) = value else {
        return "NULL".into();
    };
    if engine == EngineKind::Mssql && is_hex_literal(value) {
        return value.to_string();
    }
    let escaped = value.replace('\'', "''");
    if engine == EngineKind::Mssql {
        format!("N'{escaped}'")
    } else {
        format!("'{escaped}'")
    }
}

fn is_hex_literal(value: &str) -> bool {
    let rest = value.strip_prefix("0x").unwrap_or("");
    !rest.is_empty() && rest.chars().all(|ch| ch.is_ascii_hexdigit())
}

fn parse_statement(
    engine: EngineKind,
    sql: &str,
    tokens: &[Token],
    start: usize,
    end: usize,
    statement_index: usize,
) -> Result<Option<WritePlan>, String> {
    let tokens = tokens
        .iter()
        .filter(|token| token.start >= start && token.start < end)
        .cloned()
        .collect::<Vec<_>>();
    if tokens.is_empty() {
        return Ok(None);
    }
    if is_definition(&tokens) {
        return Ok(None);
    }
    if is_explain(&tokens) {
        if tokens
            .iter()
            .any(|token| token.kind == TokenKind::Word && is_write_word(&token.text))
        {
            return Err(refuse(
                sql,
                start,
                end,
                "EXPLAIN that would change rows cannot be backed up, so it was not run.",
            ));
        }
        return Ok(None);
    }
    if dynamic_write(&tokens) {
        return Err(refuse(
            sql,
            start,
            end,
            "Dynamic SQL that updates or deletes rows cannot be backed up, so it was not run.",
        ));
    }
    let mut parser = Parser {
        engine,
        sql,
        tokens: &tokens,
        index: 0,
    };
    let cte_names = if parser.eat_word("WITH") {
        parser.parse_ctes(start, end)?
    } else {
        Vec::new()
    };
    let with_sql = if parser.index == 0 {
        String::new()
    } else {
        let verb_at = parser.peek().map(|token| token.start).unwrap_or(end);
        sql[start..verb_at].trim().to_string()
    };
    let Some(verb) = parser.peek().cloned() else {
        return Ok(None);
    };
    if verb.kind != TokenKind::Word {
        return Ok(None);
    }
    if eq(&verb.text, "MERGE") {
        return Err(refuse(
            sql,
            start,
            end,
            "MERGE cannot be backed up, so it was not run.",
        ));
    }
    if eq(&verb.text, "UPDATE") {
        parser.bump();
        let plan = parser.parse_write(
            WriteKind::Update,
            start,
            end,
            statement_index,
            with_sql,
            &cte_names,
        )?;
        return Ok(Some(plan));
    }
    if eq(&verb.text, "DELETE") {
        parser.bump();
        let plan = parser.parse_write(
            WriteKind::Delete,
            start,
            end,
            statement_index,
            with_sql,
            &cte_names,
        )?;
        return Ok(Some(plan));
    }
    if nested_write(&tokens) {
        return Err(refuse(
            sql,
            start,
            end,
            "This UPDATE or DELETE is nested inside another statement, so the rows it would change cannot be backed up. Run it as its own statement.",
        ));
    }
    Ok(None)
}

struct Parser<'a> {
    engine: EngineKind,
    sql: &'a str,
    tokens: &'a [Token],
    index: usize,
}

impl<'a> Parser<'a> {
    fn peek(&self) -> Option<&Token> {
        self.tokens.get(self.index)
    }

    fn bump(&mut self) -> Option<Token> {
        let token = self.tokens.get(self.index).cloned()?;
        self.index += 1;
        Some(token)
    }

    fn eat_word(&mut self, word: &str) -> bool {
        match self.peek() {
            Some(token) if token.kind == TokenKind::Word && eq(&token.text, word) => {
                self.bump();
                true
            }
            _ => false,
        }
    }

    fn parse_ctes(&mut self, start: usize, end: usize) -> Result<Vec<String>, String> {
        let mut names = Vec::new();
        let mut allow_recursive = true;
        loop {
            if allow_recursive {
                self.eat_word("RECURSIVE");
                allow_recursive = false;
            }
            let Some(name) = self.bump() else {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "A WITH clause is missing its query name.",
                ));
            };
            if !matches!(name.kind, TokenKind::Word | TokenKind::Ident) {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "A WITH clause is missing its query name.",
                ));
            }
            names.push(name.text);
            if matches!(self.peek().map(|token| token.kind), Some(TokenKind::Open)) {
                self.bump();
                self.skip_group();
            }
            if !self.eat_word("AS") {
                return Err(refuse(self.sql, start, end, "A WITH clause is missing AS."));
            }
            if !matches!(self.peek().map(|token| token.kind), Some(TokenKind::Open)) {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "A WITH clause is missing its body.",
                ));
            }
            let body_start = self.index + 1;
            self.bump();
            self.skip_group();
            let body_end = self.index.saturating_sub(1);
            if body_writes(&self.tokens[body_start..body_end]) {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "A data-modifying CTE cannot be backed up, so it was not run.",
                ));
            }
            if !self.eat_comma() {
                break;
            }
        }
        Ok(names)
    }

    fn eat_comma(&mut self) -> bool {
        match self.peek() {
            Some(token) if token.kind == TokenKind::Comma => {
                self.bump();
                true
            }
            _ => false,
        }
    }

    fn skip_group(&mut self) {
        let mut depth = 1i32;
        while depth > 0 {
            let Some(token) = self.bump() else {
                break;
            };
            match token.kind {
                TokenKind::Open => depth += 1,
                TokenKind::Close => depth -= 1,
                _ => {}
            }
        }
    }

    fn parse_write(
        &mut self,
        kind: WriteKind,
        start: usize,
        end: usize,
        statement_index: usize,
        with_sql: String,
        cte_names: &[String],
    ) -> Result<WritePlan, String> {
        self.skip_modifiers();
        if self.peek_word("TOP") {
            return Err(refuse(
                self.sql,
                start,
                end,
                "TOP limits an arbitrary set of rows, so a backup might not match the rows that would change.",
            ));
        }
        if kind == WriteKind::Delete {
            self.eat_word("FROM");
        }
        let only = self.eat_word("ONLY");
        let (table_raw, table_parts) = self.parse_table(start, end)?;
        if table_parts.len() > 3 || (self.engine != EngineKind::Mssql && table_parts.len() > 2) {
            return Err(refuse(
                self.sql,
                start,
                end,
                "This table name has too many parts to back up safely.",
            ));
        }
        let target = table_parts.last().map(String::as_str).unwrap_or("");
        if cte_names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(target))
        {
            return Err(refuse(
                self.sql,
                start,
                end,
                "The target is a CTE, so the changed rows cannot be backed up.",
            ));
        }
        if self.peek_clause_comma() {
            return Err(self.multi_table(kind, start, end));
        }
        let alias_sql = self.parse_alias();
        if self.trailing_table() {
            return Err(self.multi_table(kind, start, end));
        }
        if self
            .peek()
            .is_some_and(|token| token.kind == TokenKind::Word && is_limit_word(&token.text))
        {
            return Err(self.limit_error(start, end));
        }
        let set_columns = if kind == WriteKind::Update {
            if !self.eat_word("SET") {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "This UPDATE has no SET clause, so it was not run.",
                ));
            }
            self.parse_assignments(start, end)?
        } else {
            Vec::new()
        };
        if !self.eat_word("WHERE") {
            return Err(refuse(
                self.sql,
                start,
                end,
                &format!(
                    "This {} has no WHERE clause that can be backed up, so it was not run.",
                    kind.label()
                ),
            ));
        }
        let where_sql = self.parse_filter(start, end)?;
        Ok(WritePlan {
            kind,
            preview: preview(self.sql, start, end),
            table_raw,
            table_parts,
            only,
            alias_sql,
            where_sql,
            with_sql,
            set_columns,
            statement_index,
        })
    }

    fn multi_table(&self, kind: WriteKind, start: usize, end: usize) -> String {
        refuse(
            self.sql,
            start,
            end,
            &format!(
                "This {} touches more than one table, so the changed rows cannot be backed up.",
                kind.label()
            ),
        )
    }

    fn skip_modifiers(&mut self) {
        while self.peek_word("LOW_PRIORITY")
            || self.peek_word("IGNORE")
            || self.peek_word("QUICK")
            || self.peek_word("DELAYED")
        {
            self.bump();
        }
    }

    fn peek_word(&self, word: &str) -> bool {
        matches!(self.peek(), Some(token) if token.kind == TokenKind::Word && eq(&token.text, word))
    }

    fn peek_clause_comma(&self) -> bool {
        matches!(self.peek(), Some(token) if token.kind == TokenKind::Comma)
    }

    fn trailing_table(&self) -> bool {
        match self.peek() {
            Some(token) if token.kind == TokenKind::Comma => true,
            Some(token) if token.kind == TokenKind::Word && is_join_word(&token.text) => true,
            _ => false,
        }
    }

    fn parse_table(&mut self, start: usize, end: usize) -> Result<(String, Vec<String>), String> {
        let Some(first) = self.bump() else {
            return Err(refuse(
                self.sql,
                start,
                end,
                "The target table is missing, so the statement was not run.",
            ));
        };
        if !matches!(first.kind, TokenKind::Word | TokenKind::Ident) {
            return Err(refuse(
                self.sql,
                start,
                end,
                "The target table is missing, so the statement was not run.",
            ));
        }
        let table_start = first.start;
        let mut table_end = first.end;
        let mut parts = vec![part_name(self.engine, &first)];
        while matches!(self.peek().map(|token| token.kind), Some(TokenKind::Dot)) {
            self.bump();
            let Some(next) = self.bump() else {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "The target table name is incomplete.",
                ));
            };
            if !matches!(next.kind, TokenKind::Word | TokenKind::Ident) {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "The target table name is incomplete.",
                ));
            }
            table_end = next.end;
            parts.push(part_name(self.engine, &next));
        }
        let raw = self.sql[table_start..table_end].trim().to_string();
        Ok((raw, parts))
    }

    fn parse_alias(&mut self) -> String {
        let as_token = if self.peek_word("AS") {
            self.bump()
        } else {
            None
        };
        let Some(token) = self.peek() else {
            return String::new();
        };
        if !matches!(token.kind, TokenKind::Word | TokenKind::Ident) || is_clause_word(&token.text)
        {
            return String::new();
        }
        let alias = self.bump().expect("alias was peeked");
        let from = as_token
            .as_ref()
            .map(|token| token.start)
            .unwrap_or(alias.start);
        format!(" {}", self.sql[from..alias.end].trim())
    }

    fn parse_assignments(&mut self, start: usize, end: usize) -> Result<Vec<String>, String> {
        let mut columns = Vec::new();
        let mut depth = 0i32;
        let mut last_ident: Option<String> = None;
        loop {
            let Some(token) = self.peek().cloned() else {
                return Err(refuse(
                    self.sql,
                    start,
                    end,
                    "This UPDATE has no WHERE clause that can be backed up, so it was not run.",
                ));
            };
            match token.kind {
                TokenKind::Open => {
                    depth += 1;
                    last_ident = None;
                    self.bump();
                }
                TokenKind::Close => {
                    depth -= 1;
                    self.bump();
                }
                TokenKind::Dot if depth == 0 => {
                    last_ident = None;
                    self.bump();
                }
                TokenKind::Eq if depth == 0 => {
                    if let Some(name) = last_ident.take() {
                        columns.push(name);
                    }
                    self.bump();
                }
                TokenKind::Word if depth == 0 && eq(&token.text, "WHERE") => return Ok(columns),
                TokenKind::Word if depth == 0 && is_join_word(&token.text) => {
                    return Err(refuse(
                        self.sql,
                        start,
                        end,
                        "This UPDATE uses FROM or JOIN, so the changed rows cannot be backed up.",
                    ));
                }
                TokenKind::Word | TokenKind::Ident if depth == 0 => {
                    if is_limit_word(&token.text) {
                        return Err(self.limit_error(start, end));
                    }
                    last_ident = Some(token.text.clone());
                    self.bump();
                }
                _ => {
                    self.bump();
                }
            }
        }
    }

    fn parse_filter(&mut self, start: usize, end: usize) -> Result<String, String> {
        let filter_start = self
            .tokens
            .get(self.index.saturating_sub(1))
            .map(|token| token.end)
            .unwrap_or(start);
        let mut depth = 0i32;
        let mut filter_end = end;
        while let Some(token) = self.peek().cloned() {
            match token.kind {
                TokenKind::Open => {
                    depth += 1;
                    self.bump();
                }
                TokenKind::Close => {
                    depth -= 1;
                    self.bump();
                }
                TokenKind::Word if depth == 0 && is_limit_word(&token.text) => {
                    return Err(self.limit_error(start, end));
                }
                TokenKind::Word if depth == 0 && is_tail_word(&token.text) => {
                    filter_end = token.start;
                    break;
                }
                _ => {
                    self.bump();
                }
            }
        }
        let where_sql = self.sql[filter_start..filter_end]
            .trim()
            .trim_end_matches(';')
            .trim()
            .to_string();
        if where_sql.is_empty() {
            return Err(refuse(
                self.sql,
                start,
                end,
                "This WHERE clause is empty, so the statement was not run.",
            ));
        }
        Ok(where_sql)
    }

    fn limit_error(&self, start: usize, end: usize) -> String {
        refuse(
            self.sql,
            start,
            end,
            "TOP, LIMIT, FETCH, or OFFSET chooses an arbitrary set of rows, so a backup might not match the rows that would change.",
        )
    }
}

fn body_writes(tokens: &[Token]) -> bool {
    let mut depth = 0i32;
    let mut at_verb = true;
    let mut index = 0;
    while index < tokens.len() {
        let token = &tokens[index];
        match token.kind {
            TokenKind::Open => {
                depth += 1;
                index += 1;
            }
            TokenKind::Close => {
                depth -= 1;
                index += 1;
            }
            TokenKind::Semi if depth == 0 => {
                at_verb = true;
                index += 1;
            }
            TokenKind::Word
                if token_is(token, "AS")
                    && tokens.get(index + 1).map(|next| next.kind) == Some(TokenKind::Open) =>
            {
                depth += 1;
                index += 2;
                at_verb = true;
            }
            TokenKind::Word if depth == 0 && at_verb => {
                if is_write_word(&token.text)
                    || eq(&token.text, "INSERT")
                    || eq(&token.text, "MERGE")
                {
                    return true;
                }
                if !is_explain_word(&token.text) {
                    at_verb = false;
                }
                index += 1;
            }
            _ => index += 1,
        }
    }
    false
}

fn nested_write(tokens: &[Token]) -> bool {
    let mut depth = 0i32;
    let mut seen_main = false;
    for (index, token) in tokens.iter().enumerate() {
        match token.kind {
            TokenKind::Open => depth += 1,
            TokenKind::Close => depth -= 1,
            TokenKind::Word if depth == 0 => {
                if !seen_main {
                    seen_main = true;
                    continue;
                }
                if is_write_word(&token.text) && previous_word_is_boundary(tokens, index) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn previous_word_is_boundary(tokens: &[Token], index: usize) -> bool {
    tokens[..index]
        .iter()
        .rev()
        .find_map(|token| match token.kind {
            TokenKind::Word | TokenKind::Ident => Some(is_block_word(&token.text)),
            _ => None,
        })
        .unwrap_or(false)
}

fn dynamic_write(tokens: &[Token]) -> bool {
    let carrier = tokens.iter().any(|token| {
        token.kind == TokenKind::Word
            && (eq(&token.text, "EXEC")
                || eq(&token.text, "EXECUTE")
                || eq(&token.text, "PREPARE")
                || eq(&token.text, "sp_executesql"))
    });
    carrier
        && tokens
            .iter()
            .any(|token| token.kind == TokenKind::String && string_is_write(&token.text))
}

fn string_is_write(text: &str) -> bool {
    let words = text
        .split(|ch: char| !ch.is_ascii_alphanumeric() && ch != '_')
        .filter(|word| !word.is_empty())
        .collect::<Vec<_>>();
    let Some(first) = words.first() else {
        return false;
    };
    if eq(first, "UPDATE") || eq(first, "DELETE") {
        return true;
    }
    eq(first, "WITH") && words.iter().any(|word| is_write_word(word))
}

fn is_definition(tokens: &[Token]) -> bool {
    tokens
        .iter()
        .find(|token| token.kind == TokenKind::Word)
        .is_some_and(|token| {
            eq(&token.text, "CREATE") || eq(&token.text, "ALTER") || eq(&token.text, "DROP")
        })
}

fn is_explain(tokens: &[Token]) -> bool {
    tokens
        .first()
        .is_some_and(|token| token.kind == TokenKind::Word && is_explain_word(&token.text))
}

fn is_explain_word(word: &str) -> bool {
    eq(word, "EXPLAIN") || eq(word, "ANALYZE") || eq(word, "VERBOSE")
}

fn is_write_word(word: &str) -> bool {
    eq(word, "UPDATE") || eq(word, "DELETE")
}

fn is_txn_word(word: &str) -> bool {
    eq(word, "BEGIN")
        || eq(word, "COMMIT")
        || eq(word, "ROLLBACK")
        || eq(word, "SAVEPOINT")
        || eq(word, "START")
}

fn is_join_word(word: &str) -> bool {
    eq(word, "JOIN")
        || eq(word, "INNER")
        || eq(word, "LEFT")
        || eq(word, "RIGHT")
        || eq(word, "FULL")
        || eq(word, "CROSS")
        || eq(word, "APPLY")
        || eq(word, "USING")
        || eq(word, "FROM")
}

fn is_clause_word(word: &str) -> bool {
    is_join_word(word)
        || is_limit_word(word)
        || is_tail_word(word)
        || eq(word, "SET")
        || eq(word, "WHERE")
        || eq(word, "ON")
        || eq(word, "UNION")
        || eq(word, "EXCEPT")
        || eq(word, "INTERSECT")
        || eq(word, "GROUP")
        || eq(word, "HAVING")
        || eq(word, "WINDOW")
        || eq(word, "PIVOT")
        || eq(word, "WHEN")
        || eq(word, "THEN")
        || eq(word, "ELSE")
        || eq(word, "END")
        || eq(word, "AND")
        || eq(word, "OR")
        || eq(word, "NOT")
        || eq(word, "AS")
}

fn is_limit_word(word: &str) -> bool {
    eq(word, "LIMIT") || eq(word, "TOP") || eq(word, "FETCH") || eq(word, "OFFSET")
}

fn is_tail_word(word: &str) -> bool {
    eq(word, "RETURNING") || eq(word, "OUTPUT") || eq(word, "OPTION")
}

fn is_block_word(word: &str) -> bool {
    eq(word, "BEGIN")
        || eq(word, "THEN")
        || eq(word, "ELSE")
        || eq(word, "DO")
        || eq(word, "LOOP")
        || eq(word, "IF")
        || eq(word, "ELSEIF")
        || eq(word, "ELSIF")
        || eq(word, "WHILE")
        || eq(word, "FOREACH")
        || eq(word, "TRAN")
        || eq(word, "TRANSACTION")
}

fn part_name(engine: EngineKind, token: &Token) -> String {
    if engine == EngineKind::Postgres && token.kind == TokenKind::Word {
        token.text.to_ascii_lowercase()
    } else {
        token.text.clone()
    }
}

fn token_is(token: &Token, word: &str) -> bool {
    token.kind == TokenKind::Word && eq(&token.text, word)
}

fn refuse(sql: &str, start: usize, end: usize, reason: &str) -> String {
    format!(
        "This batch was not executed. {reason}\n\n{}",
        preview(sql, start, end)
    )
}

fn preview(sql: &str, start: usize, end: usize) -> String {
    let raw = sql
        .get(start.min(sql.len())..end.min(sql.len()))
        .unwrap_or("");
    let flat = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let flat = flat.trim().trim_end_matches(';').trim();
    let mut out = String::new();
    for (index, ch) in flat.chars().enumerate() {
        if index == 140 {
            out.push('…');
            break;
        }
        out.push(ch);
    }
    out
}

fn statement_ranges(sql: &str, tokens: &[Token]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut start = 0usize;
    let mut depth = 0i32;
    for token in tokens {
        match token.kind {
            TokenKind::Open => depth += 1,
            TokenKind::Close => depth -= 1,
            TokenKind::Semi if depth == 0 => {
                if let Some(range) = trimmed_range(sql, start, token.start) {
                    ranges.push(range);
                }
                start = token.end;
            }
            _ => {}
        }
    }
    if let Some(range) = trimmed_range(sql, start, sql.len()) {
        ranges.push(range);
    }
    ranges
}

fn trimmed_range(sql: &str, start: usize, end: usize) -> Option<(usize, usize)> {
    let slice = sql.get(start..end)?;
    let leading = slice.len() - slice.trim_start().len();
    let trailing = slice.len() - slice.trim_end().len();
    let from = start + leading;
    let to = end - trailing;
    if from >= to { None } else { Some((from, to)) }
}

fn eq(word: &str, expected: &str) -> bool {
    word.eq_ignore_ascii_case(expected)
}

fn lex(sql: &str) -> Vec<Token> {
    let mut tokens = Vec::new();
    let mut chars = sql.char_indices().peekable();
    let mut line_start = true;
    while let Some((start, ch)) = chars.next() {
        if ch == '\n' {
            line_start = true;
            continue;
        }
        if ch.is_whitespace() {
            continue;
        }
        if ch == '-' && matches!(chars.peek(), Some((_, '-'))) {
            chars.next();
            for (_, next) in chars.by_ref() {
                if next == '\n' {
                    line_start = true;
                    break;
                }
            }
            continue;
        }
        if ch == '#' {
            for (_, next) in chars.by_ref() {
                if next == '\n' {
                    line_start = true;
                    break;
                }
            }
            continue;
        }
        if ch == '/' && matches!(chars.peek(), Some((_, '*'))) {
            chars.next();
            let mut depth = 1;
            while let Some((_, next)) = chars.next() {
                if next == '/' && matches!(chars.peek(), Some((_, '*'))) {
                    chars.next();
                    depth += 1;
                } else if next == '*' && matches!(chars.peek(), Some((_, '/'))) {
                    chars.next();
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                } else if next == '\n' {
                    line_start = true;
                }
            }
            continue;
        }
        if ch == '\'' {
            let (text, end) = take_quoted(sql, &mut chars, start, '\'', false);
            tokens.push(Token {
                kind: TokenKind::String,
                start,
                end,
                text,
            });
            line_start = false;
            continue;
        }
        if ch == '"' || ch == '`' {
            let (text, end) = take_quoted(sql, &mut chars, start, ch, false);
            tokens.push(Token {
                kind: TokenKind::Ident,
                start,
                end,
                text,
            });
            line_start = false;
            continue;
        }
        if ch == '[' {
            let (text, end) = take_bracket(sql, &mut chars, start);
            tokens.push(Token {
                kind: TokenKind::Ident,
                start,
                end,
                text,
            });
            line_start = false;
            continue;
        }
        if ch == '$' {
            if let Some((text, end)) = take_dollar(sql, &mut chars, start) {
                tokens.push(Token {
                    kind: TokenKind::String,
                    start,
                    end,
                    text,
                });
                line_start = false;
                continue;
            }
        }
        if ch == '(' {
            tokens.push(Token {
                kind: TokenKind::Open,
                start,
                end: start + ch.len_utf8(),
                text: "(".into(),
            });
            line_start = false;
            continue;
        }
        if ch == ')' {
            tokens.push(Token {
                kind: TokenKind::Close,
                start,
                end: start + ch.len_utf8(),
                text: ")".into(),
            });
            line_start = false;
            continue;
        }
        if ch == ';' {
            tokens.push(Token {
                kind: TokenKind::Semi,
                start,
                end: start + ch.len_utf8(),
                text: ";".into(),
            });
            line_start = false;
            continue;
        }
        if ch == ',' {
            tokens.push(Token {
                kind: TokenKind::Comma,
                start,
                end: start + ch.len_utf8(),
                text: ",".into(),
            });
            line_start = false;
            continue;
        }
        if ch == '.' {
            tokens.push(Token {
                kind: TokenKind::Dot,
                start,
                end: start + ch.len_utf8(),
                text: ".".into(),
            });
            line_start = false;
            continue;
        }
        if ch == '=' {
            tokens.push(Token {
                kind: TokenKind::Eq,
                start,
                end: start + ch.len_utf8(),
                text: "=".into(),
            });
            line_start = false;
            continue;
        }
        if is_word_char(ch) {
            let mut end = start + ch.len_utf8();
            while let Some((next_at, next)) = chars.peek().copied() {
                if !is_word_char(next) {
                    break;
                }
                end = next_at + next.len_utf8();
                chars.next();
            }
            let word = sql[start..end].to_string();
            if line_start && eq(&word, "GO") && rest_of_line_empty(&mut chars) {
                tokens.push(Token {
                    kind: TokenKind::Semi,
                    start,
                    end,
                    text: word,
                });
                line_start = true;
                continue;
            }
            if is_string_prefix(&word) && matches!(chars.peek(), Some((_, '\''))) {
                chars.next();
                let (text, string_end) = take_quoted(sql, &mut chars, end, '\'', true);
                tokens.push(Token {
                    kind: TokenKind::String,
                    start,
                    end: string_end,
                    text,
                });
                line_start = false;
                continue;
            }
            tokens.push(Token {
                kind: TokenKind::Word,
                start,
                end,
                text: word,
            });
            line_start = false;
            continue;
        }
        let end = start + ch.len_utf8();
        tokens.push(Token {
            kind: TokenKind::Other,
            start,
            end,
            text: ch.to_string(),
        });
        line_start = false;
    }
    tokens
}

fn is_string_prefix(word: &str) -> bool {
    eq(word, "N") || eq(word, "E") || eq(word, "X") || eq(word, "B") || word.starts_with('_')
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '@' || ch == '#'
}

fn take_quoted(
    sql: &str,
    chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    start: usize,
    quote: char,
    started: bool,
) -> (String, usize) {
    let mut text = String::new();
    let mut end = if started {
        start
    } else {
        start + quote.len_utf8()
    };
    if !started {
        let _ = start;
    }
    while let Some((index, ch)) = chars.next() {
        end = index + ch.len_utf8();
        if ch == '\\' {
            if let Some((next_at, next)) = chars.next() {
                text.push(next);
                end = next_at + next.len_utf8();
            }
            continue;
        }
        if ch == quote {
            if matches!(chars.peek(), Some((_, next)) if *next == quote) {
                chars.next();
                text.push(quote);
                end = sql.len().min(end + quote.len_utf8());
                if let Some((next_at, _)) = chars.peek().copied() {
                    let _ = next_at;
                }
                continue;
            }
            break;
        }
        text.push(ch);
    }
    let _ = sql;
    (text, end)
}

fn take_bracket(
    sql: &str,
    chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    start: usize,
) -> (String, usize) {
    let mut text = String::new();
    let mut end = start + 1;
    while let Some((index, ch)) = chars.next() {
        end = index + ch.len_utf8();
        if ch == ']' {
            if matches!(chars.peek(), Some((_, ']'))) {
                chars.next();
                text.push(']');
                continue;
            }
            break;
        }
        text.push(ch);
    }
    let _ = sql;
    (text, end)
}

fn take_dollar(
    sql: &str,
    chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    start: usize,
) -> Option<(String, usize)> {
    let tag = dollar_tag(chars, start, sql)?;
    let bytes: Vec<char> = tag.chars().collect();
    let mut matched = 0;
    let mut content = String::new();
    let mut end = start + tag.len();
    for (index, ch) in chars.by_ref() {
        end = index + ch.len_utf8();
        if ch == bytes[matched] {
            matched += 1;
            if matched == bytes.len() {
                let extra = tag.chars().count();
                content.truncate(content.chars().count().saturating_sub(extra));
                break;
            }
        } else if ch == bytes[0] {
            content.push(ch);
            matched = 1;
        } else {
            if matched > 0 {
                for kept in bytes.iter().take(matched) {
                    content.push(*kept);
                }
            }
            content.push(ch);
            matched = 0;
        }
    }
    Some((content, end))
}

fn dollar_tag(
    chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>,
    start: usize,
    sql: &str,
) -> Option<String> {
    let (_, ch) = chars.peek().copied()?;
    if ch == '$' {
        chars.next();
        return Some("$$".into());
    }
    if !(ch == '_' || ch.is_ascii_alphabetic()) {
        return None;
    }
    chars.next();
    while let Some((next_at, next)) = chars.peek().copied() {
        if next == '$' {
            chars.next();
            return Some(sql[start..=next_at].to_string());
        }
        if !(next == '_' || next.is_ascii_alphanumeric()) {
            return None;
        }
        chars.next();
    }
    None
}

fn rest_of_line_empty(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>) -> bool {
    let mut look = chars.clone();
    while let Some((_, ch)) = look.next() {
        if ch == '\n' {
            return true;
        }
        if ch.is_whitespace() {
            continue;
        }
        if ch == '-' && matches!(look.peek(), Some((_, '-'))) {
            return true;
        }
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn first(engine: EngineKind, sql: &str) -> WritePlan {
        let plans = plan_writes(engine, sql).unwrap();
        assert_eq!(plans.len(), 1, "{sql}");
        plans.into_iter().next().unwrap()
    }

    #[test]
    fn plans_a_simple_update_for_each_engine() {
        let sql = "UPDATE users SET name = 'Ada' WHERE id = 1";
        for engine in [EngineKind::Postgres, EngineKind::Mysql, EngineKind::Mssql] {
            let plan = first(engine, sql);
            assert_eq!(plan.kind, WriteKind::Update);
            assert_eq!(plan.table_parts, vec!["users"]);
            assert_eq!(plan.set_columns, vec!["name"]);
            assert_eq!(plan.where_sql, "id = 1");
            let snapshot = snapshot_sql(engine, &plan, true);
            assert!(snapshot.contains("FROM users"));
            assert!(snapshot.contains("WHERE id = 1"));
            assert!(snapshot.contains("5001"));
            match engine {
                EngineKind::Mssql => assert!(snapshot.contains("UPDLOCK")),
                EngineKind::Postgres => assert!(snapshot.contains("FOR UPDATE")),
                EngineKind::Mysql => assert!(snapshot.contains("FOR UPDATE")),
            }
        }
    }

    #[test]
    fn plans_qualified_delete_and_keeps_alias() {
        let plan = first(
            EngineKind::Mssql,
            "DELETE FROM [dbo].[Users] AS u WHERE u.id = 4",
        );
        assert_eq!(plan.kind, WriteKind::Delete);
        assert_eq!(plan.table_raw, "[dbo].[Users]");
        assert_eq!(
            plan.table_parts,
            vec!["dbo".to_string(), "Users".to_string()]
        );
        assert_eq!(plan.alias_sql, " AS u");
        let snapshot = snapshot_sql(EngineKind::Mssql, &plan, false);
        assert!(snapshot.contains("FROM [dbo].[Users] AS u WHERE u.id = 4"));
        assert!(!snapshot.contains("UPDLOCK"));
    }

    #[test]
    fn folds_unquoted_postgres_names() {
        let plan = first(
            EngineKind::Postgres,
            "UPDATE Public.Users SET \"Name\" = 'A' WHERE id = 1",
        );
        assert_eq!(plan.table_parts, vec!["public", "users"]);
        assert_eq!(plan.set_columns, vec!["Name"]);
        assert_eq!(plan.table_raw, "Public.Users");
    }

    #[test]
    fn keeps_with_prefix_and_refuses_modifying_cte() {
        let plan = first(
            EngineKind::Postgres,
            "WITH c AS (SELECT 1 AS id) UPDATE users u SET active = 0 WHERE u.id IN (SELECT id FROM c)",
        );
        assert!(plan.with_sql.to_ascii_lowercase().starts_with("with c"));
        let snapshot = snapshot_sql(EngineKind::Postgres, &plan, false);
        assert!(snapshot.to_ascii_lowercase().starts_with("with c"));
        assert!(snapshot.contains("FROM users u WHERE"));
        let error = plan_writes(
            EngineKind::Postgres,
            "WITH gone AS (DELETE FROM logs WHERE id = 1 RETURNING *) SELECT * FROM gone",
        )
        .unwrap_err();
        assert!(error.contains("data-modifying CTE"));
        assert!(error.contains("was not executed"));
    }

    #[test]
    fn refuses_shapes_that_cannot_be_backed_up() {
        let cases = [
            (
                "UPDATE a JOIN b ON a.id = b.id SET a.name = 'x' WHERE a.id = 1",
                "more than one table",
            ),
            (
                "UPDATE users SET name = 'x' FROM accounts WHERE users.id = accounts.id",
                "FROM or JOIN",
            ),
            (
                "DELETE u FROM users u JOIN accounts a ON a.id = u.id WHERE u.id = 1",
                "more than one table",
            ),
            ("DELETE FROM logs LIMIT 10", "LIMIT"),
            ("UPDATE users SET name = 'x' WHERE id = 1 LIMIT 2", "LIMIT"),
            ("DELETE TOP (3) FROM users WHERE active = 0", "TOP"),
            (
                "EXEC('UPDATE users SET name = ''x'' WHERE id = 1')",
                "Dynamic SQL",
            ),
            (
                "EXEC sp_executesql N'DELETE FROM users WHERE id = 1'",
                "Dynamic SQL",
            ),
            (
                "BEGIN UPDATE users SET name = 'x' WHERE id = 1; END",
                "nested",
            ),
            (
                "EXPLAIN ANALYZE UPDATE users SET name = 'x' WHERE id = 1",
                "EXPLAIN",
            ),
            (
                "MERGE INTO users u USING accounts a ON a.id = u.id WHEN MATCHED THEN UPDATE SET name = a.name WHERE u.id = 1",
                "MERGE",
            ),
        ];
        for (sql, needle) in cases {
            let error = plan_writes(EngineKind::Postgres, sql).unwrap_err();
            assert!(error.contains(needle), "{sql} => {error}");
            assert!(error.contains("was not executed"), "{sql}");
        }
    }

    #[test]
    fn where_inside_a_string_does_not_count_as_the_filter() {
        let error =
            plan_writes(EngineKind::Mysql, "UPDATE users SET note = 'WHERE id = 1'").unwrap_err();
        assert!(error.contains("no WHERE"));
        let plan = first(
            EngineKind::Mysql,
            "UPDATE users SET note = 'WHERE' WHERE id = 2",
        );
        assert_eq!(plan.where_sql, "id = 2");
        assert_eq!(plan.set_columns, vec!["note"]);
    }

    #[test]
    fn reads_and_inserts_need_no_backup() {
        assert!(
            plan_writes(
                EngineKind::Postgres,
                "SELECT * FROM users; INSERT INTO users(id) VALUES (1)"
            )
            .unwrap()
            .is_empty()
        );
        assert!(
            plan_writes(
                EngineKind::Mssql,
                "CREATE PROCEDURE p AS BEGIN UPDATE users SET active = 0 WHERE id = 1; END",
            )
            .unwrap()
            .is_empty()
        );
    }

    #[test]
    fn splits_batches_on_semicolons_and_go() {
        let plans = plan_writes(
            EngineKind::Mssql,
            "UPDATE users SET name = 'a' WHERE id = 1;\nGO\nDELETE FROM logs WHERE id = 2",
        )
        .unwrap();
        assert_eq!(plans.len(), 2);
        assert_eq!(plans[0].kind, WriteKind::Update);
        assert_eq!(plans[1].kind, WriteKind::Delete);
        assert_eq!(plans[1].statement_index, 1);
    }

    #[test]
    fn strips_returning_from_the_snapshot_filter() {
        let plan = first(
            EngineKind::Postgres,
            "UPDATE users SET name = 'a' WHERE id = 1 RETURNING *",
        );
        assert_eq!(plan.where_sql, "id = 1");
    }

    #[test]
    fn detects_transaction_control_outside_strings() {
        assert!(batch_controls_transaction(
            "BEGIN TRANSACTION; UPDATE users SET name = 'a' WHERE id = 1; COMMIT"
        ));
        assert!(!batch_controls_transaction(
            "UPDATE users SET note = 'BEGIN' WHERE id = 1"
        ));
    }

    #[test]
    fn restore_puts_update_values_back_and_reinserts_deletes() {
        let update = RowBackup {
            statement_index: 1,
            kind: WriteKind::Update,
            table_sql: "[dbo].[users]".into(),
            columns: vec!["id".into(), "name".into()],
            rows: vec![
                vec![Some("1".into()), Some("O'Brien".into())],
                vec![Some("2".into()), None],
            ],
            key_columns: vec!["id".into()],
            write_columns: vec!["name".into()],
            identity_insert: false,
            overriding_system: false,
        };
        let delete = RowBackup {
            statement_index: 0,
            kind: WriteKind::Delete,
            table_sql: "\"public\".\"logs\"".into(),
            columns: vec!["id".into(), "note".into()],
            rows: vec![vec![Some("9".into()), None]],
            key_columns: Vec::new(),
            write_columns: vec!["id".into(), "note".into()],
            identity_insert: false,
            overriding_system: true,
        };
        let statements = restore_statements(EngineKind::Mssql, &[update]);
        assert_eq!(statements.len(), 2);
        assert!(statements[0].contains("SET [name] = N'O''Brien'"));
        assert!(statements[0].contains("WHERE [id] = N'1'"));
        assert!(statements[1].contains("[name] = NULL"));
        assert!(statements[1].contains("WHERE [id] = N'2'"));
        let inserted = restore_statements(EngineKind::Postgres, &[delete]);
        assert_eq!(inserted.len(), 1);
        assert!(inserted[0].contains("INSERT INTO \"public\".\"logs\" (\"id\", \"note\") OVERRIDING SYSTEM VALUE VALUES ('9', NULL)"));
    }

    #[test]
    fn mssql_delete_restore_toggles_identity_insert() {
        let backup = RowBackup {
            statement_index: 0,
            kind: WriteKind::Delete,
            table_sql: "[dbo].[users]".into(),
            columns: vec!["id".into(), "name".into()],
            rows: vec![vec![Some("1".into()), Some("Ada".into())]],
            key_columns: Vec::new(),
            write_columns: vec!["id".into(), "name".into()],
            identity_insert: true,
            overriding_system: false,
        };
        let statements = restore_statements(EngineKind::Mssql, &[backup]);
        assert_eq!(statements[0], "SET IDENTITY_INSERT [dbo].[users] ON");
        assert!(statements[1].contains("VALUES (N'1', N'Ada')"));
        assert_eq!(statements[2], "SET IDENTITY_INSERT [dbo].[users] OFF");
    }

    #[test]
    fn payload_limit_counts_serialized_rows() {
        let rows = vec![vec![Some("abc".into())]];
        assert!(payload_bytes(&rows) < MAX_BACKUP_BYTES);
        assert!(
            too_many_rows_message(WriteKind::Delete, "DELETE FROM logs WHERE id > 0")
                .contains("5000")
        );
        assert!(
            too_large_message(
                WriteKind::Update,
                "UPDATE users SET note = 'x' WHERE id > 0"
            )
            .contains("8 MB")
        );
    }
}
