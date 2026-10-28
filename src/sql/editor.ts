import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { format, type SqlLanguage } from "sql-formatter";
import { quoteIdent, type EngineKind } from "../types";

export type SqlCatalog = {
  engine: EngineKind;
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
    insertText:
      "CREATE PROCEDURE ${1:procedure_name}\nAS\nBEGIN\n    SELECT ${2:*}\n    FROM ${3:table};\nEND;",
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
  mysql: ["NOW", "IFNULL", "LENGTH", "SUBSTRING", "GROUP_CONCAT", "DATE_ADD", "DATE_SUB", "LEFT", "RIGHT", "IFNULL"],
};

let catalog: SqlCatalog = emptyCatalog("postgres");
const engines = new WeakMap<editor.ITextModel, EngineKind>();
let registered = false;

export function emptyCatalog(engine: EngineKind): SqlCatalog {
  return { engine, tables: [], columns: [], routines: [] };
}

export function setSqlCatalog(next: SqlCatalog) {
  catalog = next;
}

export function bindModelEngine(model: editor.ITextModel, engine: EngineKind) {
  engines.set(model, engine);
}

export function formatSql(sql: string, engine: EngineKind): string {
  if (!sql.trim()) return sql;
  const language: SqlLanguage = engine === "mssql" ? "transactsql" : engine === "mysql" ? "mysql" : "postgresql";
  try {
    return format(sql, {
      language,
      keywordCase: "upper",
      functionCase: "upper",
      indentStyle: "standard",
      tabWidth: 4,
      logicalOperatorNewline: "before",
      linesBetweenQueries: 1,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not format this SQL. ${message}`);
  }
}

export function insertSnippet(codeEditor: editor.IStandaloneCodeEditor, snippet: string) {
  codeEditor.focus();
  const controller = codeEditor.getContribution("snippetController2") as { insert?: (template: string) => void } | null;
  if (controller?.insert) {
    controller.insert(snippet);
    return;
  }
  const selection = codeEditor.getSelection();
  if (!selection) return;
  const plain = snippet.replace(/\$\{\d+:([^}]*)\}/g, "$1").replace(/\$\d+/g, "");
  codeEditor.executeEdits("snippet", [{ range: selection, text: plain, forceMoveMarkers: true }]);
}

export function registerSqlEditor(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.registerCompletionItemProvider("sql", {
    triggerCharacters: [".", " ", "("],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const engine = engines.get(model) ?? catalog.engine;
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const before = model.getLineContent(position.lineNumber).slice(0, Math.max(0, position.column - 1));
      const dotted = before.match(/([A-Za-z0-9_\[\]"`]+(?:\.[A-Za-z0-9_\[\]"`]+)*)\s*\.\s*([A-Za-z0-9_]*)$/);
      const suggestions: languagesCompletion[] = [];

      if (dotted) {
        const raw = stripQuotes(dotted[1]);
        const parts = raw.split(".");
        const tableName = parts[parts.length - 1] ?? "";
        const schemaName = parts.length > 1 ? parts[parts.length - 2] : "";
        for (const column of catalog.columns) {
          if (!same(column.table, tableName)) continue;
          if (schemaName && !same(column.schema, schemaName)) continue;
          suggestions.push(
            item(monaco, range, column.name, monaco.languages.CompletionItemKind.Field, `${column.table} · ${column.dataType}`, plainIdent(engine, column.name), "1"),
          );
        }
        for (const table of catalog.tables) {
          if (!same(table.schema, raw)) continue;
          suggestions.push(tableItem(monaco, range, engine, table, "1"));
        }
        return { suggestions };
      }

      for (const snippet of SQL_SNIPPETS) {
        suggestions.push({
          label: snippet.label,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.insertText,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: snippet.detail,
          documentation: snippet.documentation,
          range,
          sortText: `0${snippet.label}`,
        });
      }
      for (const name of [...SHARED_FUNCTIONS, ...ENGINE_FUNCTIONS[engine]]) {
        suggestions.push(
          item(
            monaco,
            range,
            name,
            monaco.languages.CompletionItemKind.Function,
            "function",
            `${name}(\${1})`,
            "1",
            true,
          ),
        );
      }
      for (const table of catalog.tables) {
        suggestions.push(tableItem(monaco, range, engine, table, "2"));
      }
      for (const routine of catalog.routines) {
        const qualified =
          engine === "mysql"
            ? plainIdent(engine, routine.name)
            : `${plainIdent(engine, routine.schema)}.${plainIdent(engine, routine.name)}`;
        suggestions.push(
          item(
            monaco,
            range,
            routine.name,
            routine.kind === "procedure"
              ? monaco.languages.CompletionItemKind.Method
              : monaco.languages.CompletionItemKind.Function,
            `${routine.kind} · ${routine.schema}`,
            `${qualified}(\${1})`,
            "3",
            true,
          ),
        );
      }
      for (const column of catalog.columns) {
        suggestions.push(
          item(
            monaco,
            range,
            column.name,
            monaco.languages.CompletionItemKind.Field,
            `${column.schema}.${column.table} · ${column.dataType}`,
            plainIdent(engine, column.name),
            "4",
          ),
        );
      }
      return { suggestions };
    },
  });

  monaco.languages.registerDocumentFormattingEditProvider("sql", {
    provideDocumentFormattingEdits(model: editor.ITextModel) {
      try {
        const text = formatSql(model.getValue(), engines.get(model) ?? catalog.engine);
        return [{ range: model.getFullModelRange(), text }];
      } catch {
        return [];
      }
    },
  });
}

type languagesCompletion = {
  label: string;
  kind: number;
  insertText: string;
  insertTextRules?: number;
  detail?: string;
  documentation?: string;
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number };
  sortText?: string;
  filterText?: string;
};

function item(
  monaco: Monaco,
  range: languagesCompletion["range"],
  label: string,
  kind: number,
  detail: string,
  insertText: string,
  sort: string,
  snippet = false,
): languagesCompletion {
  return {
    label,
    kind,
    insertText,
    insertTextRules: snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    detail,
    range,
    sortText: `${sort}${label}`,
    filterText: label,
  };
}

function tableItem(
  monaco: Monaco,
  range: languagesCompletion["range"],
  engine: EngineKind,
  table: { schema: string; name: string; kind: string },
  sort: string,
): languagesCompletion {
  const qualified =
    engine === "mysql"
      ? plainIdent(engine, table.name)
      : `${plainIdent(engine, table.schema)}.${plainIdent(engine, table.name)}`;
  return item(
    monaco,
    range,
    engine === "mysql" ? table.name : `${table.schema}.${table.name}`,
    table.kind === "view" ? monaco.languages.CompletionItemKind.Interface : monaco.languages.CompletionItemKind.Struct,
    table.kind,
    qualified,
    sort,
  );
}

function plainIdent(engine: EngineKind, name: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  return quoteIdent(engine, name);
}

function stripQuotes(value: string): string {
  return value
    .split(".")
    .map((part) => part.replace(/^[\[`"]|[\]`"]$/g, "").replace(/""/g, '"').replace(/``/g, "`").replace(/]]/g, "]"))
    .join(".");
}

function same(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}
