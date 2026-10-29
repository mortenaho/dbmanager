#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Update,
    Delete,
}

impl Kind {
    fn label(self) -> &'static str {
        match self {
            Self::Update => "UPDATE",
            Self::Delete => "DELETE",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WithStep {
    No,
    Name,
    AfterName,
    AfterAs,
    Done,
}

struct Frame {
    at_verb: bool,
    with_step: WithStep,
    write: Option<Kind>,
    has_where: bool,
    start: usize,
}

impl Frame {
    fn statement(start: usize) -> Self {
        Self {
            at_verb: true,
            with_step: WithStep::No,
            write: None,
            has_where: false,
            start,
        }
    }

    fn expression(start: usize) -> Self {
        Self {
            at_verb: false,
            with_step: WithStep::No,
            write: None,
            has_where: false,
            start,
        }
    }
}

struct Hit {
    kind: Kind,
    preview: String,
}

enum Tok {
    Word(String),
    Open,
    Close,
    Semi,
    Comma,
}

struct Token {
    tok: Tok,
    start: usize,
    end: usize,
}

pub fn unconditional_write_warning(sql: &str) -> Option<String> {
    let hits = find_unconditional_writes(sql);
    if hits.is_empty() {
        return None;
    }
    let head = if hits.len() == 1 {
        format!(
            "This batch was not executed. {} changes rows without a WHERE clause.",
            hits[0].kind.label()
        )
    } else {
        format!(
            "This batch was not executed. {} statements change rows without a WHERE clause.",
            hits.len()
        )
    };
    let mut lines = vec![head, String::new()];
    for hit in &hits {
        if hit.preview.is_empty() {
            lines.push(format!("{} without a WHERE clause.", hit.kind.label()));
        } else {
            lines.push(hit.preview.clone());
        }
    }
    lines.push(String::new());
    lines.push("Add a WHERE clause to limit the rows, then run it again.".into());
    Some(lines.join("\n"))
}

fn find_unconditional_writes(sql: &str) -> Vec<Hit> {
    let tokens = tokenize(sql);
    let mut stack = vec![Frame::statement(0)];
    let mut hits = Vec::new();
    for token in &tokens {
        match token.tok {
            Tok::Open => {
                let parent = stack.last_mut().unwrap();
                let body = parent.with_step == WithStep::AfterAs;
                stack.push(if body {
                    Frame::statement(token.end)
                } else {
                    Frame::expression(token.end)
                });
            }
            Tok::Close => {
                if stack.len() > 1 {
                    let done = stack.pop().unwrap();
                    record(&done, sql, token.start, &mut hits);
                    if let Some(parent) = stack.last_mut() {
                        if parent.with_step == WithStep::AfterAs {
                            parent.with_step = WithStep::Done;
                        }
                    }
                }
            }
            Tok::Semi => {
                while stack.len() > 1 {
                    let done = stack.pop().unwrap();
                    record(&done, sql, token.start, &mut hits);
                }
                let root = stack.last_mut().unwrap();
                record(root, sql, token.start, &mut hits);
                *root = Frame::statement(token.end);
            }
            Tok::Comma => {
                let frame = stack.last_mut().unwrap();
                if frame.with_step == WithStep::Done {
                    frame.with_step = WithStep::Name;
                }
            }
            Tok::Word(ref word) => on_word(stack.last_mut().unwrap(), word),
        }
    }
    let end = sql.len();
    while let Some(done) = stack.pop() {
        record(&done, sql, end, &mut hits);
    }
    hits
}

fn on_word(frame: &mut Frame, word: &str) {
    if frame.with_step == WithStep::Done {
        frame.with_step = WithStep::No;
        frame.at_verb = true;
    }
    if frame.at_verb {
        if eq(word, "WITH") {
            frame.at_verb = false;
            frame.with_step = WithStep::Name;
            return;
        }
        if eq(word, "EXPLAIN") || eq(word, "ANALYZE") || eq(word, "VERBOSE") {
            return;
        }
        frame.at_verb = false;
        frame.write = if eq(word, "UPDATE") {
            Some(Kind::Update)
        } else if eq(word, "DELETE") {
            Some(Kind::Delete)
        } else {
            None
        };
        return;
    }
    match frame.with_step {
        WithStep::Name => {
            if !eq(word, "RECURSIVE") {
                frame.with_step = WithStep::AfterName;
            }
        }
        WithStep::AfterName if eq(word, "AS") => frame.with_step = WithStep::AfterAs,
        WithStep::AfterAs => {}
        _ if eq(word, "WHERE") && frame.write.is_some() => frame.has_where = true,
        _ => {}
    }
}

fn record(frame: &Frame, sql: &str, end: usize, hits: &mut Vec<Hit>) {
    let Some(kind) = frame.write else {
        return;
    };
    if frame.has_where {
        return;
    }
    hits.push(Hit {
        kind,
        preview: preview(sql, frame.start, end),
    });
}

fn preview(sql: &str, start: usize, end: usize) -> String {
    let raw = sql.get(start.min(sql.len())..end.min(sql.len())).unwrap_or("");
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

fn eq(word: &str, expected: &str) -> bool {
    word.eq_ignore_ascii_case(expected)
}

fn tokenize(sql: &str) -> Vec<Token> {
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
        if ch == '\'' || ch == '"' || ch == '`' {
            skip_quoted(&mut chars, ch);
            line_start = false;
            continue;
        }
        if ch == '[' {
            skip_bracket(&mut chars);
            line_start = false;
            continue;
        }
        if ch == '$' && skip_dollar(&mut chars, start, sql) {
            line_start = false;
            continue;
        }
        if ch == '(' {
            tokens.push(Token { tok: Tok::Open, start, end: start + ch.len_utf8() });
            line_start = false;
            continue;
        }
        if ch == ')' {
            tokens.push(Token { tok: Tok::Close, start, end: start + ch.len_utf8() });
            line_start = false;
            continue;
        }
        if ch == ';' {
            tokens.push(Token { tok: Tok::Semi, start, end: start + ch.len_utf8() });
            line_start = false;
            continue;
        }
        if ch == ',' {
            tokens.push(Token { tok: Tok::Comma, start, end: start + ch.len_utf8() });
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
                tokens.push(Token { tok: Tok::Semi, start, end });
                line_start = true;
                continue;
            }
            tokens.push(Token { tok: Tok::Word(word), start, end });
            line_start = false;
            continue;
        }
        line_start = false;
    }
    tokens
}

fn is_word_char(ch: char) -> bool {
    ch.is_ascii_alphanumeric() || ch == '_' || ch == '@' || ch == '#'
}

fn skip_quoted(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>, quote: char) {
    while let Some((_, ch)) = chars.next() {
        if ch == '\\' {
            chars.next();
            continue;
        }
        if ch == quote {
            if matches!(chars.peek(), Some((_, next)) if *next == quote) {
                chars.next();
                continue;
            }
            break;
        }
    }
}

fn skip_bracket(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>) {
    while let Some((_, ch)) = chars.next() {
        if ch == ']' {
            if matches!(chars.peek(), Some((_, ']'))) {
                chars.next();
                continue;
            }
            break;
        }
    }
}

fn skip_dollar(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>, start: usize, sql: &str) -> bool {
    let tag = dollar_tag(chars, start, sql);
    let Some(tag) = tag else {
        return false;
    };
    let bytes: Vec<char> = tag.chars().collect();
    let mut matched = 0;
    for (_, ch) in chars.by_ref() {
        if ch == bytes[matched] {
            matched += 1;
            if matched == bytes.len() {
                break;
            }
        } else if ch == bytes[0] {
            matched = 1;
        } else {
            matched = 0;
        }
    }
    true
}

fn dollar_tag(chars: &mut std::iter::Peekable<std::str::CharIndices<'_>>, start: usize, sql: &str) -> Option<String> {
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
            for (_, next) in look.by_ref() {
                if next == '\n' {
                    return true;
                }
            }
            return true;
        }
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::unconditional_write_warning;

    fn blocked(sql: &str) -> bool {
        unconditional_write_warning(sql).is_some()
    }

    #[test]
    fn blocks_update_and_delete_without_where() {
        let update = unconditional_write_warning("UPDATE users SET active = 0").unwrap();
        assert!(update.contains("was not executed"));
        assert!(update.contains("UPDATE"));
        assert!(update.contains("UPDATE users SET active = 0"));
        assert!(blocked("delete from logs"));
        assert!(blocked("DeLeTe FROM logs"));
    }

    #[test]
    fn allows_writes_that_have_a_where_clause() {
        assert!(!blocked("UPDATE users SET active = 0 WHERE id = 1"));
        assert!(!blocked("DELETE FROM logs WHERE created_at < now()"));
        assert!(!blocked("UPDATE t SET a = 1 WHERE id IN (SELECT id FROM u WHERE id = 2)"));
        assert!(!blocked("SELECT * FROM users"));
        assert!(!blocked("UPDATE t SET a = 1 WHERE id = 1; SELECT 1"));
    }

    #[test]
    fn where_inside_a_string_comment_or_expression_does_not_count() {
        assert!(blocked("UPDATE t SET note = 'WHERE id = 1'"));
        assert!(blocked("UPDATE t SET note = 'it\\'s WHERE'"));
        assert!(blocked("DELETE FROM t -- WHERE id = 1"));
        assert!(blocked("/* WHERE id = 1 */ DELETE FROM t"));
        assert!(blocked("UPDATE t SET a = (SELECT 1 WHERE 1 = 1)"));
        assert!(blocked("UPDATE t SET where_col = 1"));
        assert!(blocked("UPDATE t SET a = $$ WHERE $$"));
        assert!(!blocked("UPDATE t SET a = 'x' WHERE id = 1"));
    }

    #[test]
    fn blocks_only_the_unsafe_statement_in_a_batch() {
        let warning = unconditional_write_warning("UPDATE t SET a = 1 WHERE id = 1; DELETE FROM u").unwrap();
        assert!(warning.contains("DELETE FROM u"));
        assert!(!warning.contains("SET a = 1 WHERE"));
        assert!(blocked("DELETE FROM t WHERE id = 1\nGO\nDELETE FROM u"));
        assert!(!blocked("SELECT 1\nGO\nSELECT 2"));
    }

    #[test]
    fn catches_writes_inside_a_data_modifying_cte() {
        assert!(blocked("WITH gone AS (DELETE FROM logs RETURNING *) SELECT * FROM gone"));
        assert!(blocked(
            "WITH one AS (SELECT 1), gone AS (UPDATE users SET active = 0 RETURNING id) SELECT * FROM gone"
        ));
        assert!(!blocked(
            "WITH gone AS (DELETE FROM logs WHERE id = 1 RETURNING *) SELECT * FROM gone"
        ));
        assert!(!blocked("WITH c AS (SELECT 1) UPDATE users SET active = 0 WHERE id = 1"));
    }

    #[test]
    fn explain_analyze_update_without_where_is_blocked() {
        assert!(blocked("EXPLAIN ANALYZE UPDATE users SET active = 0"));
        assert!(!blocked("EXPLAIN SELECT * FROM users"));
        assert!(!blocked("CREATE PROCEDURE p AS BEGIN UPDATE users SET active = 0 WHERE id = 1; END"));
    }
}
