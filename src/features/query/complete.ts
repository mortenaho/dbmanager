import { quoteIdent, type EngineKind } from "../../shared/types";

export type SqlCatalog = {
  engine: EngineKind;
  database: string;
  databases: string[];
  tables: Array<{ schema: string; name: string; kind: string }>;
  columns: Array<{ schema: string; table: string; name: string; dataType: string }>;
  routines: Array<{ schema: string; name: string; kind: string }>;
};

export type SqlSnippet = {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
};

export type SqlSuggestion = {
  label: string;
  kind: "snippet" | "function" | "database" | "schema" | "table" | "view" | "column" | "routine";
  insertText: string;
  filterText: string;
  detail: string;
  documentation?: string;
  snippet?: boolean;
  sort: string;
};

export const SQL_SNIPPETS: SqlSnippet[] = [
  {
    label: "sel",
    detail: "SELECT",
    documentation: "Select rows from a table",
    insertText: "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};",
  },
  {
    label: "select",
    detail: "SELECT",
    documentation: "Select rows from a table",
    insertText: "SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};",
  },
  {
    label: "ins",
    detail: "INSERT",
    documentation: "Insert one row",
    insertText: "INSERT INTO ${1:table} (${2:column})\nVALUES (${3:value});",
  },
  {
    label: "upd",
    detail: "UPDATE",
    documentation: "Update rows",
    insertText: "UPDATE ${1:table}\nSET ${2:column} = ${3:value}\nWHERE ${4:condition};",
  },
  {
    label: "del",
    detail: "DELETE",
    documentation: "Delete rows",
    insertText: "DELETE FROM ${1:table}\nWHERE ${2:condition};",
  },
  {
    label: "join",
    detail: "INNER JOIN",
    documentation: "Join another table",
    insertText: "INNER JOIN ${1:other} ON ${1:other}.${2:id} = ${3:table}.${2:id}",
  },
  {
    label: "leftjoin",
    detail: "LEFT JOIN",
    documentation: "Left join another table",
    insertText: "LEFT JOIN ${1:other} ON ${1:other}.${2:id} = ${3:table}.${2:id}",
  },
  {
    label: "cte",
    detail: "WITH",
    documentation: "Common table expression",
    insertText: "WITH ${1:cte} AS (\n    SELECT ${2:*}\n    FROM ${3:table}\n)\nSELECT ${2:*}\nFROM ${1:cte};",
  },
  {
    label: "groupby",
    detail: "GROUP BY",
    documentation: "Group and aggregate",
    insertText: "SELECT ${1:column}, COUNT(*) AS row_count\nFROM ${2:table}\nGROUP BY ${1:column}\nORDER BY row_count DESC;",
  },
  {
    label: "createproc",
    detail: "CREATE PROCEDURE",
    documentation: "Stored procedure stub",
    insertText: "CREATE PROCEDURE ${1:procedure_name}\nAS\nBEGIN\n    SELECT ${2:*}\n    FROM ${3:table};\nEND;",
  },
  {
    label: "createfn",
    detail: "CREATE FUNCTION",
    documentation: "Function stub",
    insertText: "CREATE FUNCTION ${1:function_name}()\nRETURNS ${2:int}\nAS\nBEGIN\n    RETURN ${3:0};\nEND;",
  },
];

const SHARED_FUNCTIONS = ["COUNT", "SUM", "AVG", "MIN", "MAX", "COALESCE", "NULLIF", "CAST", "UPPER", "LOWER", "TRIM", "ROUND", "ABS", "CONCAT", "REPLACE", "ROW_NUMBER", "RANK", "DENSE_RANK", "LAG", "LEAD"];

const ENGINE_FUNCTIONS: Record<EngineKind, string[]> = {
  mssql: ["GETDATE", "ISNULL", "LEN", "SUBSTRING", "DATEADD", "DATEDIFF", "STRING_AGG", "CONVERT", "LEFT", "RIGHT"],
  postgres: ["NOW", "LENGTH", "SUBSTRING", "STRING_AGG", "DATE_TRUNC", "TO_CHAR", "LEFT", "RIGHT", "GREATEST", "LEAST"],
  mysql: ["NOW", "IFNULL", "LENGTH", "SUBSTRING", "GROUP_CONCAT", "DATE_ADD", "DATE_SUB", "LEFT", "RIGHT"],
};

const KEYWORDS = new Set(
  `SELECT FROM WHERE JOIN INNER LEFT RIGHT FULL CROSS OUTER ON AND OR NOT
INSERT INTO VALUES UPDATE SET DELETE USE DATABASE TABLE CREATE ALTER DROP
TRUNCATE PROCEDURE FUNCTION EXEC EXECUTE CALL AS ORDER GROUP BY HAVING
LIMIT OFFSET UNION ALL DISTINCT TOP BEGIN END WITH GO RETURNING WHEN THEN
ELSE CASE IS NULL IN EXISTS BETWEEN LIKE ASC DESC OVER PARTITION APPLY PIVOT`
    .split(/\s+/)
    .filter(Boolean),
);

const TABLE_KEYWORDS = new Set(["FROM", "JOIN", "INTO", "UPDATE", "TABLE"]);
const COLUMN_KEYWORDS = new Set(["SELECT", "WHERE", "SET", "ON", "HAVING", "RETURNING", "BY", "AND", "OR", "WHEN", "THEN", "ELSE", "VALUES"]);
const DATABASE_KEYWORDS = new Set(["USE", "DATABASE"]);
const ROUTINE_KEYWORDS = new Set(["EXEC", "EXECUTE", "CALL"]);

type Clause = "database" | "table" | "column" | "routine" | "statement";

type Tok = {
  kind: "ident" | "keyword" | "symbol";
  text: string;
  upper: string;
  start: number;
  end: number;
};

type TableRef = { schema: string; name: string; alias: string };

const QUOTED_IDENT = "`[^`]*`";
const IDENT = `(?:\\[[^\\]]+\\]|${QUOTED_IDENT}|"[^"]*"|[A-Za-z_][A-Za-z0-9_@#$]*)`;
const DOTTED = new RegExp(`(${IDENT}(?:\\s*\\.\\s*${IDENT})*)\\s*\\.\\s*([A-Za-z0-9_@#$]*)$`);

export function emptyCatalog(engine: EngineKind): SqlCatalog {
  return { engine, database: "", databases: [], tables: [], columns: [], routines: [] };
}

export function sqlFunctions(engine: EngineKind): string[] {
  return [...SHARED_FUNCTIONS, ...ENGINE_FUNCTIONS[engine]];
}

export function buildSqlSuggestions(input: {
  sql: string;
  offset: number;
  catalog: SqlCatalog;
  snippets: SqlSnippet[];
  functions: string[];
}): SqlSuggestion[] {
  const located = locateStatement(input.sql, input.offset);
  if (located.literal) return [];
  const before = located.text.slice(0, located.cursor);
  const tokens = tokenize(located.text);
  const beforeTokens = tokens.filter((token) => token.start < located.cursor);
  const dotted = dottedTail(before);
  const word = dotted ? dotted.word : trailingWord(before);
  const clause = clauseAt(beforeTokens.filter((token) => !(token.kind !== "symbol" && token.end >= located.cursor)));
  const refs = referencedTables(tokens, input.catalog);

  if (dotted) {
    return unique(membersAfterDot(dotted.parts, clause, input.catalog, refs, word));
  }
  if (clause === "database") return unique(databases(input.catalog, word));
  if (clause === "table") return unique(tableClause(input.catalog, word));
  if (clause === "routine") return unique(routines(input.catalog, word));
  if (clause === "column") return unique(columnClause(input.catalog, refs, input.functions, word));
  return unique(statementClause(input.snippets, input.functions, word));
}

function statementClause(snippets: SqlSnippet[], functions: string[], word: string): SqlSuggestion[] {
  const items: SqlSuggestion[] = [];
  for (const snippet of snippets) {
    if (!starts(word, snippet.label) && !starts(word, snippet.detail)) continue;
    items.push({
      label: snippet.label,
      kind: "snippet",
      insertText: snippet.insertText,
      filterText: snippet.label,
      detail: snippet.detail,
      documentation: snippet.documentation,
      snippet: true,
      sort: `0${snippet.label}`,
    });
  }
  if (word) items.push(...functionsOf(functions, word, "1"));
  return items;
}

function columnClause(catalog: SqlCatalog, refs: TableRef[], functions: string[], word: string): SqlSuggestion[] {
  const items: SqlSuggestion[] = [];
  if (refs.length) items.push(...columnsOf(catalog, refs, word, "1"));
  else items.push(...tablesOf(catalog, catalog.tables, word, false, "2"));
  if (word) items.push(...functionsOf(functions, word, "3"));
  return items;
}

function tableClause(catalog: SqlCatalog, word: string): SqlSuggestion[] {
  return [
    ...tablesOf(catalog, catalog.tables, word, false, "1"),
    ...schemas(catalog, word, "2"),
    ...databases(catalog, word).map((item) => ({ ...item, sort: `3${item.label}` })),
  ];
}

function membersAfterDot(
  parts: string[],
  clause: Clause,
  catalog: SqlCatalog,
  refs: TableRef[],
  word: string,
): SqlSuggestion[] {
  if (!parts.length) return [];
  if (parts.length === 1) return onePart(parts[0], clause, catalog, refs, word);
  if (parts.length === 2) return twoParts(parts[0], parts[1], clause, catalog, word);
  return tableColumns(catalog, parts[parts.length - 2] ?? "", parts[parts.length - 1] ?? "", clause, word);
}

function onePart(name: string, clause: Clause, catalog: SqlCatalog, refs: TableRef[], word: string): SqlSuggestion[] {
  const aliasRefs = refs.filter((ref) => ref.alias && same(ref.alias, name));
  const schemaHit = schemaNames(catalog).some((schema) => same(schema, name));
  const dbHit = isDatabase(catalog, name);
  const tableHit = catalog.tables.some((table) => same(table.name, name));
  if (aliasRefs.length && clause !== "table") return columnsOf(catalog, aliasRefs, word, "1");
  if (clause === "table") {
    if (schemaHit) return tablesOf(catalog, catalog.tables.filter((table) => same(table.schema, name)), word, true, "1");
    if (dbHit) return databaseTail(catalog, name, word);
    return [];
  }
  if (tableHit && schemaHit) {
    const used = refs.some((ref) => same(ref.name, name));
    if (used) return columnsOf(catalog, refs.filter((ref) => same(ref.name, name)), word, "1");
    return tablesOf(catalog, catalog.tables.filter((table) => same(table.schema, name)), word, true, "1");
  }
  if (tableHit) return columnsOf(catalog, catalog.tables.filter((table) => same(table.name, name)).map(asRef), word, "1");
  if (schemaHit) return tablesOf(catalog, catalog.tables.filter((table) => same(table.schema, name)), word, true, "1");
  if (dbHit) return databaseTail(catalog, name, word);
  return [];
}

function twoParts(a: string, b: string, clause: Clause, catalog: SqlCatalog, word: string): SqlSuggestion[] {
  const db = isDatabase(catalog, a);
  const schemaB = schemaNames(catalog).some((schema) => same(schema, b));
  const schemaA = schemaNames(catalog).some((schema) => same(schema, a));
  const tableAB = catalog.tables.some((table) => same(table.schema, a) && same(table.name, b));
  if (db && schemaB && ownsDatabase(catalog, a)) {
    return tablesOf(catalog, catalog.tables.filter((table) => same(table.schema, b)), word, true, "1");
  }
  if (schemaA && tableAB) return tableColumns(catalog, a, b, clause, word);
  if (db && ownsDatabase(catalog, a) && catalog.tables.some((table) => same(table.name, b))) {
    return tableColumns(catalog, "", b, clause, word);
  }
  if (schemaA && !tableAB) return [];
  return [];
}

function tableColumns(catalog: SqlCatalog, schema: string, table: string, clause: Clause, word: string): SqlSuggestion[] {
  if (clause === "table") return [];
  const refs = catalog.tables
    .filter((item) => same(item.name, table) && (!schema || same(item.schema, schema)))
    .map(asRef);
  return columnsOf(catalog, refs, word, "1");
}

function databaseTail(catalog: SqlCatalog, name: string, word: string): SqlSuggestion[] {
  if (!ownsDatabase(catalog, name)) return [];
  if (catalog.engine === "mysql") {
    return tablesOf(catalog, catalog.tables.filter((table) => same(table.schema, name) || same(catalog.database, name)), word, true, "1");
  }
  return schemas(catalog, word, "1");
}

function databases(catalog: SqlCatalog, word: string): SqlSuggestion[] {
  return catalog.databases
    .filter((name) => starts(word, name))
    .map((name) => ({
      label: name,
      kind: "database" as const,
      insertText: plainIdent(catalog.engine, name),
      filterText: name,
      detail: "database",
      sort: `1${name}`,
    }));
}

function schemas(catalog: SqlCatalog, word: string, sort: string): SqlSuggestion[] {
  return schemaNames(catalog)
    .filter((name) => starts(word, name))
    .map((name) => ({
      label: name,
      kind: "schema" as const,
      insertText: plainIdent(catalog.engine, name),
      filterText: name,
      detail: "schema",
      sort: `${sort}${name}`,
    }));
}

function tablesOf(
  catalog: SqlCatalog,
  tables: SqlCatalog["tables"],
  word: string,
  bare: boolean,
  sort: string,
): SqlSuggestion[] {
  const items: SqlSuggestion[] = [];
  for (const table of tables) {
    const qualified = catalog.engine === "mysql" || !table.schema ? table.name : `${table.schema}.${table.name}`;
    if (!starts(word, table.name)) continue;
    const label = bare || catalog.engine === "mysql" ? table.name : qualified;
    items.push({
      label,
      kind: table.kind === "view" ? "view" : "table",
      insertText: bare || catalog.engine === "mysql" ? plainIdent(catalog.engine, table.name) : qualify(catalog.engine, table.schema, table.name),
      filterText: bare ? table.name : `${table.name} ${qualified}`,
      detail: table.kind,
      sort: `${sort}${table.name}`,
    });
  }
  return items;
}

function columnsOf(catalog: SqlCatalog, refs: Array<{ schema: string; name: string }>, word: string, sort: string): SqlSuggestion[] {
  const items: SqlSuggestion[] = [];
  const seen = new Set<string>();
  for (const column of catalog.columns) {
    const hit = refs.some((ref) => same(ref.name, column.table) && (!ref.schema || same(ref.schema, column.schema)));
    if (!hit || !starts(word, column.name)) continue;
    const key = `${column.schema}.${column.table}.${column.name}`.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      label: column.name,
      kind: "column",
      insertText: plainIdent(catalog.engine, column.name),
      filterText: column.name,
      detail: `${column.schema ? `${column.schema}.` : ""}${column.table} · ${column.dataType}`,
      sort: `${sort}${column.name}`,
    });
  }
  return items;
}

function routines(catalog: SqlCatalog, word: string): SqlSuggestion[] {
  return catalog.routines
    .filter((routine) => starts(word, routine.name))
    .map((routine) => {
      const qualified =
        catalog.engine === "mysql" || !routine.schema
          ? plainIdent(catalog.engine, routine.name)
          : `${plainIdent(catalog.engine, routine.schema)}.${plainIdent(catalog.engine, routine.name)}`;
      return {
        label: routine.name,
        kind: "routine" as const,
        insertText: `${qualified}(\${1})`,
        filterText: routine.name,
        detail: `${routine.kind} · ${routine.schema}`,
        snippet: true,
        sort: `1${routine.name}`,
      };
    });
}

function functionsOf(functions: string[], word: string, sort: string): SqlSuggestion[] {
  const seen = new Set<string>();
  const items: SqlSuggestion[] = [];
  for (const name of functions) {
    const key = name.toUpperCase();
    if (seen.has(key) || !starts(word, name)) continue;
    seen.add(key);
    items.push({
      label: name,
      kind: "function",
      insertText: `${name}(\${1})`,
      filterText: name,
      detail: "function",
      snippet: true,
      sort: `${sort}${name}`,
    });
  }
  return items;
}

function referencedTables(tokens: Tok[], catalog: SqlCatalog): TableRef[] {
  const refs: TableRef[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "keyword" || !TABLE_KEYWORDS.has(token.upper)) continue;
    if (token.upper === "TABLE") {
      const previous = previousKeyword(tokens, index);
      if (!previous || !["CREATE", "ALTER", "DROP", "TRUNCATE"].includes(previous)) continue;
    }
    const qualified = readQualified(tokens, index + 1);
    if (!qualified.parts.length) continue;
    let cursor = qualified.next;
    let alias = "";
    if (tokens[cursor]?.upper === "AS" && tokens[cursor + 1]?.kind === "ident") {
      alias = tokens[cursor + 1].text;
      cursor += 2;
    } else if (tokens[cursor]?.kind === "ident") {
      alias = tokens[cursor].text;
    }
    const matched = matchQualified(qualified.parts, catalog);
    if (!matched.length) {
      refs.push({
        schema: qualified.parts.length > 1 ? qualified.parts[qualified.parts.length - 2] : "",
        name: qualified.parts[qualified.parts.length - 1],
        alias,
      });
      continue;
    }
    for (const table of matched) refs.push({ schema: table.schema, name: table.name, alias });
  }
  return refs;
}

function matchQualified(parts: string[], catalog: SqlCatalog): SqlCatalog["tables"] {
  if (parts.length === 1) return catalog.tables.filter((table) => same(table.name, parts[0]));
  if (parts.length === 2) {
    const bySchema = catalog.tables.filter((table) => same(table.schema, parts[0]) && same(table.name, parts[1]));
    if (bySchema.length) return bySchema;
    if (isDatabase(catalog, parts[0])) return catalog.tables.filter((table) => same(table.name, parts[1]));
    return [];
  }
  if (parts.length >= 3) {
    const schema = parts[parts.length - 2];
    const name = parts[parts.length - 1];
    return catalog.tables.filter((table) => same(table.schema, schema) && same(table.name, name));
  }
  return [];
}

function readQualified(tokens: Tok[], start: number): { parts: string[]; next: number } {
  const parts: string[] = [];
  let index = start;
  if (tokens[index]?.kind !== "ident") return { parts, next: index };
  parts.push(tokens[index].text);
  index += 1;
  while (tokens[index]?.text === "." && tokens[index + 1]?.kind === "ident") {
    parts.push(tokens[index + 1].text);
    index += 2;
  }
  return { parts, next: index };
}

function clauseAt(tokens: Tok[]): Clause {
  let clause: Clause = "statement";
  const stack: Clause[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.text === "(") {
      stack.push(clause);
      const previous = previousWord(tokens, index);
      if (clause === "table" && previous?.kind === "ident") clause = "column";
      else if (clause === "table") clause = "statement";
      continue;
    }
    if (token.text === ")") {
      clause = stack.pop() ?? "statement";
      continue;
    }
    if (token.kind !== "keyword") continue;
    if (DATABASE_KEYWORDS.has(token.upper)) clause = "database";
    else if (TABLE_KEYWORDS.has(token.upper)) clause = "table";
    else if (COLUMN_KEYWORDS.has(token.upper)) clause = "column";
    else if (ROUTINE_KEYWORDS.has(token.upper) || token.upper === "PROCEDURE" || token.upper === "FUNCTION") clause = "routine";
  }
  return clause;
}

function previousWord(tokens: Tok[], index: number): Tok | null {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].kind !== "symbol") return tokens[cursor];
  }
  return null;
}

function previousKeyword(tokens: Tok[], index: number): string {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor].kind === "keyword") return tokens[cursor].upper;
  }
  return "";
}

function dottedTail(before: string): { parts: string[]; word: string } | null {
  const match = DOTTED.exec(before);
  if (!match) return null;
  const parts = match[1].split(".").map((part) => unquote(part.trim())).filter(Boolean);
  if (!parts.length) return null;
  return { parts, word: match[2] ?? "" };
}

function trailingWord(before: string): string {
  const match = /[A-Za-z0-9_@#$]+$/.exec(before);
  return match ? match[0] : "";
}

function tokenize(sql: string): Tok[] {
  const tokens: Tok[] = [];
  let index = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (char === " " || char === "\t" || char === "\r" || char === "\n") {
      index += 1;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < sql.length && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      index = Math.min(sql.length, index + 2);
      continue;
    }
    if (char === "'") {
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }
    if (char === "[") {
      const start = index;
      index += 1;
      let body = "";
      while (index < sql.length) {
        if (sql[index] === "]" && sql[index + 1] === "]") {
          body += "]";
          index += 2;
          continue;
        }
        if (sql[index] === "]") {
          index += 1;
          break;
        }
        body += sql[index];
        index += 1;
      }
      tokens.push({ kind: "ident", text: body, upper: body.toUpperCase(), start, end: index });
      continue;
    }
    if (char === "`" || char === '"') {
      const quote = char;
      const start = index;
      index += 1;
      let body = "";
      while (index < sql.length) {
        if (sql[index] === quote && sql[index + 1] === quote) {
          body += quote;
          index += 2;
          continue;
        }
        if (sql[index] === quote) {
          index += 1;
          break;
        }
        body += sql[index];
        index += 1;
      }
      tokens.push({ kind: "ident", text: body, upper: body.toUpperCase(), start, end: index });
      continue;
    }
    if (char === "." || char === "," || char === "(" || char === ")" || char === ";") {
      tokens.push({ kind: "symbol", text: char, upper: char, start: index, end: index + 1 });
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/.test(char) || char === "@" || char === "#") {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_@#$]/.test(sql[index])) index += 1;
      const text = sql.slice(start, index);
      const upper = text.toUpperCase();
      tokens.push({
        kind: KEYWORDS.has(upper) ? "keyword" : "ident",
        text,
        upper,
        start,
        end: index,
      });
      continue;
    }
    index += 1;
  }
  return tokens;
}

function locateStatement(sql: string, offset: number): { text: string; cursor: number; literal: boolean } {
  const clamped = Math.max(0, Math.min(offset, sql.length));
  let start = 0;
  let index = 0;
  let lineStart = true;
  while (index < sql.length && index < clamped) {
    const char = sql[index];
    if (lineStart && (char === " " || char === "\t")) {
      index += 1;
      continue;
    }
    if (lineStart && /^go\b/i.test(sql.slice(index))) {
      start = index + 2;
      index += 2;
      lineStart = false;
      continue;
    }
    lineStart = char === "\n";
    if (char === "-" && sql[index + 1] === "-") {
      while (index < sql.length && sql[index] !== "\n") index += 1;
      continue;
    }
    if (char === "/" && sql[index + 1] === "*") {
      index += 2;
      while (index < clamped && !(sql[index] === "*" && sql[index + 1] === "/")) index += 1;
      if (index < clamped) index = Math.min(sql.length, index + 2);
      else return { text: "", cursor: 0, literal: true };
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      const quote = char;
      index += 1;
      while (index < clamped) {
        if (sql[index] === quote && sql[index + 1] === quote) {
          index += 2;
          continue;
        }
        if (sql[index] === quote) break;
        index += 1;
      }
      if (index >= clamped) return { text: "", cursor: 0, literal: true };
      index += 1;
      continue;
    }
    if (char === "[") {
      index += 1;
      while (index < clamped && sql[index] !== "]") index += 1;
      if (index >= clamped) return { text: "", cursor: 0, literal: true };
      index += 1;
      continue;
    }
    if (char === ";") {
      start = index + 1;
      index += 1;
      continue;
    }
    if (char === "\n") lineStart = true;
    index += 1;
  }
  let end = start;
  let cursor = start;
  let line = true;
  while (cursor < sql.length) {
    const char = sql[cursor];
    if (line && (char === " " || char === "\t")) {
      cursor += 1;
      continue;
    }
    if (line && /^go\b/i.test(sql.slice(cursor))) break;
    line = false;
    if (char === "-" && sql[cursor + 1] === "-") {
      while (cursor < sql.length && sql[cursor] !== "\n") cursor += 1;
      continue;
    }
    if (char === "/" && sql[cursor + 1] === "*") {
      cursor += 2;
      while (cursor < sql.length && !(sql[cursor] === "*" && sql[cursor + 1] === "/")) cursor += 1;
      cursor = Math.min(sql.length, cursor + 2);
      continue;
    }
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const quote = char === "[" ? "]" : char;
      cursor += 1;
      while (cursor < sql.length) {
        if (quote !== "]" && sql[cursor] === quote && sql[cursor + 1] === quote) {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === quote) {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      continue;
    }
    if (char === ";") break;
    if (char === "\n") line = true;
    cursor += 1;
  }
  end = cursor;
  return { text: sql.slice(start, end), cursor: clamped - start, literal: false };
}

function schemaNames(catalog: SqlCatalog): string[] {
  const names = new Set<string>();
  for (const table of catalog.tables) {
    if (table.schema) names.add(table.schema);
  }
  return [...names];
}

function isDatabase(catalog: SqlCatalog, name: string): boolean {
  return same(catalog.database, name) || catalog.databases.some((database) => same(database, name));
}

function ownsDatabase(catalog: SqlCatalog, name: string): boolean {
  if (!catalog.database) return isDatabase(catalog, name);
  return same(catalog.database, name);
}

function asRef(table: { schema: string; name: string }): TableRef {
  return { schema: table.schema, name: table.name, alias: "" };
}

function qualify(engine: EngineKind, schema: string, name: string): string {
  if (engine === "mysql" || !schema) return plainIdent(engine, name);
  return `${plainIdent(engine, schema)}.${plainIdent(engine, name)}`;
}

function plainIdent(engine: EngineKind, name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return quoteIdent(engine, name);
}

function unquote(value: string): string {
  if (value.startsWith("[") && value.endsWith("]")) return value.slice(1, -1).replace(/]]/g, "]");
  if ((value.startsWith("`") && value.endsWith("`")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1).replace(/``/g, "`").replace(/""/g, '"');
  }
  return value;
}

function starts(word: string, text: string): boolean {
  if (!word) return true;
  return text.toLowerCase().startsWith(word.toLowerCase());
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function unique(items: SqlSuggestion[]): SqlSuggestion[] {
  const seen = new Set<string>();
  const result: SqlSuggestion[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.label}:${item.insertText}:${item.detail}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}
