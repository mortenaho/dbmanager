import type { ColumnRef } from "./types";

const TABLE_LIMIT = 80;
const COLUMN_LIMIT = 24;
const TEXT_LIMIT = 20_000;

export function schemaText(columns: ColumnRef[]): { text: string; truncated: boolean } {
  const tables = new Map<string, string[]>();
  for (const column of columns) {
    const schema = column.schema.trim();
    const key = schema ? `${schema}.${column.table}` : column.table;
    const list = tables.get(key) ?? [];
    if (list.length < COLUMN_LIMIT) list.push(`${column.name} ${column.dataType}`.trim());
    tables.set(key, list);
  }
  const names = [...tables.keys()].sort((left, right) => left.localeCompare(right));
  const kept = names.slice(0, TABLE_LIMIT);
  let text = kept.map((name) => `${name}(${tables.get(name)?.join(", ") ?? ""})`).join("\n");
  let truncated = names.length > kept.length;
  if (text.length > TEXT_LIMIT) {
    text = text.slice(0, TEXT_LIMIT);
    truncated = true;
  }
  if (truncated) text = `${text}\nSchema truncated.`;
  return { text, truncated };
}

export function sqlWithNote(sql: string, note: string): string {
  const line = note.replace(/[\r\n]+/g, " ").trim();
  const body = sql.trim();
  if (!line) return `${body}\n`;
  return `-- ${line}\n${body}\n`;
}
