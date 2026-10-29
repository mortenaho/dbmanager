import { quoteIdent, type EngineKind } from "../types";

export type DbmlColumn = {
  name: string;
  type: string;
  pk: boolean;
  increment: boolean;
  unique: boolean;
  notNull: boolean;
  defaultValue: string;
};

export type DbmlTable = {
  schema: string;
  name: string;
  columns: DbmlColumn[];
};

export type DbmlRef = {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
};

export type DbmlModel = {
  tables: DbmlTable[];
  refs: DbmlRef[];
  errors: string[];
};

export const SAMPLE_DBML = `Table users {
  id integer [pk, increment]
  email varchar(255) [unique, not null]
  name varchar(100) [not null]
  created_at timestamp
}

Table posts {
  id integer [pk, increment]
  user_id integer [not null, ref: > users.id]
  title varchar(200) [not null]
  body text
}

Table comments {
  id integer [pk, increment]
  post_id integer [not null, ref: > posts.id]
  user_id integer [not null, ref: > users.id]
  body text [not null]
}
`;

export function parseDbml(source: string): DbmlModel {
  const text = stripComments(source);
  const tables: DbmlTable[] = [];
  const refs: DbmlRef[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < text.length) {
    i = skipWs(text, i);
    if (i >= text.length) break;
    const word = text.slice(i).match(/^[A-Za-z_][\w]*/);
    const line = lineNumber(text, i);
    if (!word) {
      errors.push(`Line ${line}: unexpected character`);
      break;
    }
    const keyword = word[0].toLowerCase();
    if (keyword === "table") {
      i += word[0].length;
      i = skipWs(text, i);
      const named = readIdent(text, i);
      if (!named) {
        errors.push(`Line ${line}: table name is missing`);
        break;
      }
      i = named.end;
      i = skipWs(text, i);
      if (text.slice(i, i + 2).toLowerCase() === "as" && /\s/.test(text[i + 2] ?? "")) {
        i += 2;
        i = skipWs(text, i);
        const alias = readPart(text, i);
        if (alias) i = alias.end;
        i = skipWs(text, i);
      }
      if (text[i] !== "{") {
        errors.push(`Line ${line}: expected { after ${named.name}`);
        break;
      }
      const block = extractBlock(text, i);
      if (!block) {
        errors.push(`Line ${line}: table ${named.name} is not closed`);
        break;
      }
      const key = tableKey(named.schema, named.name);
      if (seen.has(key)) errors.push(`Line ${line}: duplicate table ${named.name}`);
      seen.add(key);
      const columns = parseColumns(block.inner, named.schema, named.name, refs, errors);
      tables.push({ schema: named.schema, name: named.name, columns });
      i = block.end + 1;
      continue;
    }
    if (keyword === "ref" || keyword === "refs") {
      const stop = text.indexOf("\n", i);
      const end = stop < 0 ? text.length : stop;
      const parsed = parseRefLine(text.slice(i, end));
      if (parsed) refs.push(parsed);
      else errors.push(`Line ${line}: relationship is not valid`);
      i = end;
      continue;
    }
    if (keyword === "enum" || keyword === "project" || keyword === "tablegroup") {
      const brace = text.indexOf("{", i);
      if (brace < 0) break;
      const block = extractBlock(text, brace);
      if (!block) break;
      i = block.end + 1;
      continue;
    }
    errors.push(`Line ${line}: unknown ${word[0]}`);
    const stop = text.indexOf("\n", i);
    i = stop < 0 ? text.length : stop + 1;
  }
  return { tables, refs: uniqueRefs(refs), errors };
}

export function diagramToSql(model: DbmlModel, engine: EngineKind): string {
  const statements: string[] = [];
  for (const table of model.tables) {
    if (table.columns.length === 0) continue;
    const pk = table.columns.filter((column) => column.pk);
    const lines = table.columns.map((column) => `    ${columnSql(engine, column, pk.length === 1)}`);
    if (pk.length > 1) {
      const names = pk.map((column) => quoteIdent(engine, column.name)).join(", ");
      lines.push(`    PRIMARY KEY (${names})`);
    }
    statements.push(`CREATE TABLE ${qualify(engine, table.schema, table.name)} (\n${lines.join(",\n")}\n);`);
  }
  const used = new Set<string>();
  for (const ref of model.refs) {
    const from = model.tables.find((table) => sameTable(table, ref.fromSchema, ref.fromTable));
    const to = model.tables.find((table) => sameTable(table, ref.toSchema, ref.toTable));
    if (!from || !to) continue;
    if (!from.columns.some((column) => column.name.toLowerCase() === ref.fromColumn.toLowerCase())) continue;
    if (!to.columns.some((column) => column.name.toLowerCase() === ref.toColumn.toLowerCase())) continue;
    let name = `fk_${from.name}_${ref.fromColumn}`.replace(/[^A-Za-z0-9_]/g, "_");
    if (name.length > 60) name = name.slice(0, 60);
    let unique = name;
    let n = 2;
    while (used.has(unique.toLowerCase())) {
      unique = `${name.slice(0, 56)}_${n}`;
      n += 1;
    }
    used.add(unique.toLowerCase());
    statements.push(
      `ALTER TABLE ${qualify(engine, from.schema, from.name)} ADD CONSTRAINT ${quoteIdent(engine, unique)} FOREIGN KEY (${quoteIdent(engine, ref.fromColumn)}) REFERENCES ${qualify(engine, to.schema, to.name)} (${quoteIdent(engine, ref.toColumn)});`,
    );
  }
  return statements.join("\n\n");
}

export function tableKey(schema: string, name: string): string {
  return `${schema}.${name}`.toLowerCase();
}

function columnSql(engine: EngineKind, column: DbmlColumn, inlinePk: boolean): string {
  const bits = [quoteIdent(engine, column.name), column.type];
  if (column.increment && engine === "mssql") bits.push("IDENTITY(1,1)");
  if (column.increment && engine === "postgres") bits.push("GENERATED BY DEFAULT AS IDENTITY");
  if (column.notNull || column.pk) bits.push("NOT NULL");
  if (column.increment && engine === "mysql") bits.push("AUTO_INCREMENT");
  if (inlinePk && column.pk) bits.push("PRIMARY KEY");
  if (column.unique && !column.pk) bits.push("UNIQUE");
  if (column.defaultValue) bits.push(`DEFAULT ${column.defaultValue}`);
  return bits.join(" ");
}

function qualify(engine: EngineKind, schema: string, name: string): string {
  const fallback = engine === "mssql" ? "dbo" : engine === "postgres" ? "public" : "";
  const schemaName = schema || fallback;
  if (engine === "mysql" || schemaName === "") return quoteIdent(engine, name);
  return `${quoteIdent(engine, schemaName)}.${quoteIdent(engine, name)}`;
}

function sameTable(table: DbmlTable, schema: string, name: string): boolean {
  if (table.name.toLowerCase() !== name.toLowerCase()) return false;
  if (!schema || !table.schema) return true;
  return table.schema.toLowerCase() === schema.toLowerCase();
}

function parseColumns(inner: string, schema: string, table: string, refs: DbmlRef[], errors: string[]): DbmlColumn[] {
  const columns: DbmlColumn[] = [];
  let i = 0;
  while (i < inner.length) {
    i = skipWs(inner, i);
    if (i >= inner.length) break;
    if (/^indexes\b/i.test(inner.slice(i))) {
      const brace = inner.indexOf("{", i);
      if (brace < 0) break;
      const block = extractBlock(inner, brace);
      if (!block) break;
      i = block.end + 1;
      continue;
    }
    const stop = inner.indexOf("\n", i);
    const end = stop < 0 ? inner.length : stop;
    const line = inner.slice(i, end).trim();
    i = end + 1;
    if (line === "" || /^note\b/i.test(line)) continue;
    const parsed = parseColumn(line);
    if (!parsed) {
      errors.push(`Column is not valid: ${line}`);
      continue;
    }
    columns.push(parsed.column);
    for (const ref of parsed.outgoing) {
      refs.push({ fromSchema: schema, fromTable: table, fromColumn: parsed.column.name, ...ref });
    }
    for (const ref of parsed.incoming) {
      refs.push({
        fromSchema: ref.schema,
        fromTable: ref.table,
        fromColumn: ref.column,
        toSchema: schema,
        toTable: table,
        toColumn: parsed.column.name,
      });
    }
  }
  return columns;
}

function parseColumn(line: string): {
  column: DbmlColumn;
  outgoing: Array<Pick<DbmlRef, "toSchema" | "toTable" | "toColumn">>;
  incoming: Array<{ schema: string; table: string; column: string }>;
} | null {
  const named = readPart(line, skipWs(line, 0));
  if (!named) return null;
  const typeStart = skipWs(line, named.end);
  const settingsAt = indexOfSettings(line, typeStart);
  const type = line.slice(typeStart, settingsAt < 0 ? line.length : settingsAt).trim();
  if (!type) return null;
  const column: DbmlColumn = {
    name: named.value,
    type,
    pk: false,
    increment: false,
    unique: false,
    notNull: false,
    defaultValue: "",
  };
  const outgoing: Array<Pick<DbmlRef, "toSchema" | "toTable" | "toColumn">> = [];
  const incoming: Array<{ schema: string; table: string; column: string }> = [];
  const settings = settingsAt < 0 ? "" : line.slice(settingsAt + 1, closingBracket(line, settingsAt));
  for (const token of splitSettings(settings)) {
    const low = token.toLowerCase();
    if (low === "pk" || low === "primary key") column.pk = true;
    else if (low === "increment" || low === "autoincrement" || low === "identity") column.increment = true;
    else if (low === "unique") column.unique = true;
    else if (low === "not null") column.notNull = true;
    else if (low === "null") column.notNull = false;
    else if (low.startsWith("default:")) column.defaultValue = token.slice(token.indexOf(":") + 1).trim();
    else if (low.startsWith("ref:")) {
      const body = token.slice(token.indexOf(":") + 1).trim();
      const rel = body.match(/^([<>\-])\s*(.+)$/);
      if (!rel) continue;
      const target = pathOf(rel[2]);
      if (!target) continue;
      if (rel[1] === "<") incoming.push(target);
      else outgoing.push({ toSchema: target.schema, toTable: target.table, toColumn: target.column });
    }
  }
  return { column, outgoing, incoming };
}

function parseRefLine(statement: string): DbmlRef | null {
  const match = statement.trim().match(/^refs?(?:\s+[A-Za-z_][\w]*)?\s*:\s*(.+?)\s+([<>\-])\s+(.+)$/i);
  if (!match) return null;
  const left = pathOf(match[1]);
  const right = pathOf(match[3]);
  if (!left || !right) return null;
  const forward = match[2] !== "<";
  const from = forward ? left : right;
  const to = forward ? right : left;
  return {
    fromSchema: from.schema,
    fromTable: from.table,
    fromColumn: from.column,
    toSchema: to.schema,
    toTable: to.table,
    toColumn: to.column,
  };
}

function pathOf(input: string): { schema: string; table: string; column: string } | null {
  const parts: string[] = [];
  let i = 0;
  const text = input.trim();
  while (parts.length < 3 && i < text.length) {
    const part = readPart(text, i);
    if (!part) return null;
    parts.push(part.value);
    i = part.end;
    if (text[i] !== ".") break;
    i += 1;
  }
  if (text.slice(i).trim() !== "") return null;
  if (parts.length === 2) return { schema: "", table: parts[0], column: parts[1] };
  if (parts.length === 3) return { schema: parts[0], table: parts[1], column: parts[2] };
  return null;
}

function uniqueRefs(refs: DbmlRef[]): DbmlRef[] {
  const seen = new Set<string>();
  const next: DbmlRef[] = [];
  for (const ref of refs) {
    const key = [ref.fromSchema, ref.fromTable, ref.fromColumn, ref.toSchema, ref.toTable, ref.toColumn].join(".").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(ref);
  }
  return next;
}

function splitSettings(input: string): string[] {
  const items: string[] = [];
  let current = "";
  let quote = "";
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ",") {
      if (current.trim()) items.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) items.push(current.trim());
  return items;
}

function indexOfSettings(line: string, from: number): number {
  let quote = "";
  for (let i = from; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "[") return i;
  }
  return -1;
}

function closingBracket(line: string, open: number): number {
  const end = line.lastIndexOf("]");
  return end > open ? end : line.length;
}

function stripComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    if (source.startsWith("/*", i)) {
      const end = source.indexOf("*/", i + 2);
      const stop = end < 0 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (source.startsWith("--", i) || source.startsWith("//", i)) {
      const end = source.indexOf("\n", i);
      const stop = end < 0 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === "'" || ch === '"') {
      out += ch;
      i += 1;
      while (i < source.length && source[i] !== ch) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        i += 1;
      }
      if (i < source.length) {
        out += source[i];
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

function extractBlock(text: string, braceAt: number): { inner: string; end: number } | null {
  let depth = 0;
  for (let i = braceAt; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return { inner: text.slice(braceAt + 1, i), end: i };
    }
  }
  return null;
}

function readIdent(text: string, i: number): { schema: string; name: string; end: number } | null {
  const first = readPart(text, i);
  if (!first) return null;
  if (text[first.end] === ".") {
    const second = readPart(text, first.end + 1);
    if (!second) return null;
    return { schema: first.value, name: second.value, end: second.end };
  }
  return { schema: "", name: first.value, end: first.end };
}

function readPart(text: string, i: number): { value: string; end: number } | null {
  const quote = text[i];
  if (quote === '"' || quote === "'" || quote === "`") {
    const end = text.indexOf(quote, i + 1);
    if (end < 0) return null;
    return { value: text.slice(i + 1, end), end: end + 1 };
  }
  const match = text.slice(i).match(/^[A-Za-z_][\w]*/);
  if (!match) return null;
  return { value: match[0], end: i + match[0].length };
}

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i += 1;
  return i;
}

function lineNumber(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}
