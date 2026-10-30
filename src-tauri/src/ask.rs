use crate::history::AppSettings;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AskReply {
    pub sql: String,
    pub note: String,
}

const SYSTEM: &str = "\
You draft one SQL statement for a desktop SQL client. The user reviews it and runs it themselves.
Use only the named engine's dialect and only tables and columns from the schema.
Prefer SELECT. If the request changes rows, the statement must include a WHERE clause.
Reply in exactly this shape, with no markdown fences:
SQL:
<one statement>
NOTE:
<one short sentence>";

pub fn chat_url(base: &str) -> Result<String, String> {
    let trimmed = base.trim().trim_end_matches('/');
    let base = if trimmed.is_empty() {
        "https://api.openai.com/v1".to_string()
    } else {
        trimmed.to_string()
    };
    let https = base.starts_with("https://");
    let http = base.starts_with("http://");
    if !https && !http {
        return Err("The assistant URL must start with https://.".into());
    }
    let after = if https { &base[8..] } else { &base[7..] };
    if after.is_empty() || after.contains('@') || after.contains(' ') || after.contains('\\') {
        return Err("The assistant URL is not valid.".into());
    }
    let host = after.split(['/', '?', '#']).next().unwrap_or("");
    let host_only = host_name(host);
    if http && !matches!(host_only, "localhost" | "127.0.0.1" | "::1") {
        return Err("Use https:// for the assistant. http:// is only allowed for localhost.".into());
    }
    if base.ends_with("/chat/completions") {
        Ok(base)
    } else {
        Ok(format!("{base}/chat/completions"))
    }
}

fn host_name(host: &str) -> &str {
    if let Some(rest) = host.strip_prefix('[') {
        return rest.split(']').next().unwrap_or(host);
    }
    host.rsplit_once(':').map(|(name, _)| name).unwrap_or(host)
}

pub fn parse_reply(raw: &str) -> Result<AskReply, String> {
    let mut text = raw.trim().to_string();
    if text.starts_with("```") {
        if let Some(split) = text.find('\n') {
            text = text[split + 1..].to_string();
        }
        if let Some(end) = text.rfind("```") {
            text = text[..end].to_string();
        }
        text = text.trim().to_string();
    }
    let lower = text.to_ascii_lowercase();
    let (sql, note) = if let Some(sql_at) = lower.find("sql:") {
        let after = sql_at + 4;
        if let Some(rel) = lower[after..].find("note:") {
            (
                text[after..after + rel].trim().to_string(),
                text[after + rel + 5..].trim().to_string(),
            )
        } else {
            (text[after..].trim().to_string(), String::new())
        }
    } else {
        (text, String::new())
    };
    let sql = sql.trim().trim_matches('`').trim().to_string();
    if sql.is_empty() {
        return Err("The assistant did not return any SQL.".into());
    }
    let mut note = note.replace(['\r', '\n'], " ");
    if note.chars().count() > 280 {
        note = note.chars().take(280).collect();
    }
    Ok(AskReply { sql, note: note.trim().to_string() })
}

pub fn complete(
    settings: &AppSettings,
    engine: &str,
    database: &str,
    schema: &str,
    question: &str,
) -> Result<AskReply, String> {
    let question = question.trim();
    if question.is_empty() {
        return Err("Type a question first.".into());
    }
    if question.chars().count() > 4_000 {
        return Err("That question is too long.".into());
    }
    let key = settings.ai_api_key.trim();
    if key.is_empty() {
        return Err("Add an assistant API key in Tools → Options.".into());
    }
    let model = {
        let model = settings.ai_model.trim();
        if model.is_empty() { "gpt-4o-mini" } else { model }
    };
    let url = chat_url(&settings.ai_base_url)?;
    let schema = schema.trim();
    let schema = if schema.chars().count() > 24_000 {
        let cut = schema.chars().take(24_000).collect::<String>();
        format!("{cut}\nSchema truncated.")
    } else if schema.is_empty() {
        "(no tables loaded)".to_string()
    } else {
        schema.to_string()
    };
    let user = format!(
        "Engine: {engine}\nDatabase: {database}\nSchema:\n{schema}\n\nQuestion:\n{question}"
    );
    let agent = ureq::AgentBuilder::new()
        .timeout_connect(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(60))
        .build();
    let response = agent
        .post(&url)
        .set("Authorization", &format!("Bearer {key}"))
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({
            "model": model,
            "temperature": 0.1,
            "messages": [
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": user}
            ]
        }));
    let body = match response {
        Ok(response) => response.into_string().map_err(|error| error.to_string())?,
        Err(ureq::Error::Status(code, response)) => {
            let detail = response
                .into_string()
                .unwrap_or_default()
                .chars()
                .take(400)
                .collect::<String>();
            return Err(format!("The assistant returned HTTP {code}. {detail}").trim().to_string());
        }
        Err(error) => return Err(format!("Could not reach the assistant. {error}")),
    };
    let value: serde_json::Value = serde_json::from_str(&body).map_err(|_| {
        "The assistant response was not JSON.".to_string()
    })?;
    let text = message_text(&value).ok_or_else(|| "The assistant response had no text.".to_string())?;
    parse_reply(&text)
}

fn message_text(value: &serde_json::Value) -> Option<String> {
    let content = &value["choices"][0]["message"]["content"];
    if let Some(text) = content.as_str() {
        return Some(text.to_string());
    }
    let parts = content.as_array()?;
    let text = parts
        .iter()
        .filter_map(|part| part["text"].as_str().or_else(|| part.as_str()))
        .collect::<Vec<_>>()
        .join("");
    if text.is_empty() { None } else { Some(text) }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_labeled_reply_and_strips_fences() {
        let reply = parse_reply("SQL:\nSELECT 1;\nNOTE:\nCounts nothing.").unwrap();
        assert_eq!(reply.sql, "SELECT 1;");
        assert_eq!(reply.note, "Counts nothing.");
        let fenced = parse_reply("```sql\nSELECT city\nFROM customers;\n```").unwrap();
        assert_eq!(fenced.sql, "SELECT city\nFROM customers;");
        assert!(fenced.note.is_empty());
        assert!(parse_reply("   ").is_err());
    }

    #[test]
    fn allows_https_and_local_http_only() {
        assert_eq!(
            chat_url("https://api.openai.com/v1").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
        assert_eq!(
            chat_url("http://127.0.0.1:11434/v1/").unwrap(),
            "http://127.0.0.1:11434/v1/chat/completions"
        );
        assert!(chat_url("http://example.com/v1").is_err());
        assert!(chat_url("file:///tmp/x").is_err());
        assert_eq!(
            chat_url("").unwrap(),
            "https://api.openai.com/v1/chat/completions"
        );
    }
}
