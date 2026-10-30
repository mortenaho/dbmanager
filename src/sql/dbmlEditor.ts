import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import type { EngineKind } from "../types";
import { engineTypes } from "./tableDesign";

const TYPES = [
  "int",
  "integer",
  "bigint",
  "smallint",
  "tinyint",
  "bit",
  "boolean",
  "decimal",
  "numeric",
  "float",
  "real",
  "double",
  "precision",
  "money",
  "date",
  "datetime",
  "datetime2",
  "time",
  "timestamp",
  "char",
  "nchar",
  "varchar",
  "nvarchar",
  "text",
  "uuid",
  "uniqueidentifier",
];

const SETTINGS = ["pk", "increment", "unique", "not null", "null", "ref", "default", "note", "primary key"];

let designEngine: EngineKind = "mssql";
let registered = false;

export function setDbmlEngine(engine: EngineKind) {
  designEngine = engine;
}

export function registerDbmlEditor(monaco: Monaco) {
  if (registered) return;
  registered = true;

  monaco.languages.register({ id: "dbml" });
  monaco.languages.setMonarchTokensProvider("dbml", {
    ignoreCase: true,
    keywords: ["table", "ref", "indexes", "enum", "project", "tablegroup", "note"],
    types: TYPES,
    tokenizer: {
      root: [
        [/\/\/.*$/, "comment"],
        [/\/\*/, "comment", "@comment"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/`([^`\\]|\\.)*`/, "string"],
        [/\b\d+\b/, "number"],
        [/\[/, "delimiter.bracket", "@settings"],
        [
          /[A-Za-z_][\w]*/,
          {
            cases: {
              "@keywords": "keyword",
              "@types": "type",
              "@default": "identifier",
            },
          },
        ],
        [/[{}()>,.:-]/, "delimiter"],
      ],
      settings: [
        [/\]/, "delimiter.bracket", "@pop"],
        [/"([^"\\]|\\.)*"/, "string"],
        [/'([^'\\]|\\.)*'/, "string"],
        [/\b\d+\b/, "number"],
        [/[A-Za-z_][\w]*/, "attribute"],
        [/[,:>]/, "delimiter"],
      ],
      comment: [
        [/\*\//, "comment", "@pop"],
        [/./, "comment"],
      ],
    },
  });

  monaco.editor.defineTheme("dbml", {
    base: "vs",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "0000FF" },
      { token: "type", foreground: "267F99" },
      { token: "string", foreground: "A31515" },
      { token: "comment", foreground: "008000" },
      { token: "number", foreground: "098658" },
      { token: "attribute", foreground: "795E26" },
      { token: "identifier", foreground: "000000" },
    ],
    colors: {
      "editor.background": "#FFFFFF",
      "editor.foreground": "#000000",
      "editorLineNumber.foreground": "#2B91AF",
      "editor.selectionBackground": "#ADD6FF",
      "editorCursor.foreground": "#000000",
    },
  });

  monaco.languages.registerCompletionItemProvider("dbml", {
    triggerCharacters: [" ", ".", "[", ","],
    provideCompletionItems(model: editor.ITextModel, position: Position) {
      const line = model.getLineContent(position.lineNumber);
      const before = line.slice(0, position.column - 1);
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const kinds = monaco.languages.CompletionItemKind;
      const snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      const items: Array<{
        label: string;
        insertText: string;
        kind: number;
        detail: string;
        sortText: string;
        snippet?: boolean;
        filterText?: string;
      }> = [];

      if (insideBrackets(before)) {
        for (const setting of SETTINGS) {
          items.push({ label: setting, insertText: setting, kind: kinds.Property, detail: "setting", sortText: `0${setting}` });
        }
      } else if (typePosition(before)) {
        for (const type of typeSuggestions(designEngine)) {
          items.push({
            label: type.label,
            insertText: type.insert,
            kind: kinds.TypeParameter,
            detail: "type",
            sortText: `0${type.label}`,
            snippet: type.snippet,
            filterText: type.label,
          });
        }
      } else if (/^\s*\w*$/.test(before)) {
        for (const keyword of ["Table", "Ref"]) {
          items.push({ label: keyword, insertText: keyword, kind: kinds.Keyword, detail: "keyword", sortText: `0${keyword}` });
        }
      }

      const dotted = /([A-Za-z_][\w]*)\.\w*$/.exec(before);
      if (dotted) {
        for (const column of columnsOf(model.getValue(), dotted[1])) {
          items.push({ label: column, insertText: column, kind: kinds.Field, detail: dotted[1], sortText: `1${column}` });
        }
      } else if (/\bref\b/i.test(before)) {
        for (const table of tableNames(model.getValue())) {
          items.push({ label: table, insertText: table, kind: kinds.Struct, detail: "table", sortText: `1${table}` });
        }
      }

      return {
        suggestions: items.map((item) => ({
          label: item.label,
          kind: item.kind,
          insertText: item.insertText,
          insertTextRules: item.snippet ? snippet : undefined,
          detail: item.detail,
          filterText: item.filterText,
          range,
          sortText: item.sortText,
        })),
      };
    },
  });
}

function insideBrackets(before: string): boolean {
  return (before.match(/\[/g) ?? []).length > (before.match(/\]/g) ?? []).length;
}

function typePosition(before: string): boolean {
  if (/^\s*(table|ref|indexes|enum|project|tablegroup|note)\b/i.test(before)) return false;
  return /^\s*[A-Za-z_][\w]*\s+[A-Za-z_]*$/.test(before);
}

function typeSuggestions(engine: EngineKind): Array<{ label: string; insert: string; snippet: boolean }> {
  const sized = new Set(["varchar", "nvarchar", "char", "nchar"]);
  const decimal = new Set(["decimal", "numeric"]);
  return engineTypes(engine).map((type) => {
    if (sized.has(type)) return { label: type, insert: `${type}(\${1:50})`, snippet: true };
    if (decimal.has(type)) return { label: type, insert: `${type}(\${1:18}, \${2:0})`, snippet: true };
    return { label: type, insert: type, snippet: false };
  });
}

function tableNames(source: string): string[] {
  const names: string[] = [];
  const pattern = /\bTable\s+([A-Za-z_][\w]*)/gi;
  let match = pattern.exec(source);
  while (match) {
    names.push(match[1]);
    match = pattern.exec(source);
  }
  return names;
}

function columnsOf(source: string, table: string): string[] {
  const pattern = new RegExp(`\\bTable\\s+${table}\\s*\\{([^}]*)\\}`, "i");
  const body = pattern.exec(source)?.[1] ?? "";
  const columns: string[] = [];
  for (const line of body.split("\n")) {
    const name = /^\s*([A-Za-z_][\w]*)\s+/.exec(line);
    if (!name) continue;
    if (/^(indexes|note|ref)$/i.test(name[1])) continue;
    columns.push(name[1]);
  }
  return columns;
}
