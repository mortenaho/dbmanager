import type { Monaco } from "@monaco-editor/react";
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

let registered = false;

export type DbmlHint = { label: string; insert: string; detail: string };

export function dbmlHints(engine: EngineKind, before: string, source: string): DbmlHint[] {
  const prefix = /[A-Za-z_][\w]*$/.exec(before)?.[0] ?? "";
  const items: DbmlHint[] = [];
  if (insideBrackets(before)) {
    for (const setting of SETTINGS) items.push({ label: setting, insert: setting, detail: "setting" });
  } else if (typePosition(before)) {
    for (const type of typeSuggestions(engine)) {
      items.push({ label: type.label, insert: plainInsert(type.insert), detail: "type" });
    }
  } else if (/^\s*\w*$/.test(before)) {
    for (const keyword of ["Table", "Ref"]) items.push({ label: keyword, insert: keyword, detail: "keyword" });
  }
  const dotted = /([A-Za-z_][\w]*)\.\w*$/.exec(before);
  if (dotted) {
    for (const column of columnsOf(source, dotted[1])) items.push({ label: column, insert: column, detail: dotted[1] });
  } else if (/\bref\b/i.test(before)) {
    for (const table of tableNames(source)) items.push({ label: table, insert: table, detail: "table" });
  }
  const showAll = typePosition(before) || insideBrackets(before);
  if (!prefix && !showAll) return [];
  const filtered = prefix
    ? items.filter((item) => item.label.toLowerCase().startsWith(prefix.toLowerCase()))
    : items;
  if (filtered.length === 1 && filtered[0].label.toLowerCase() === prefix.toLowerCase()) return [];
  return filtered;
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
  monaco.editor.defineTheme("dbml-dark", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "569CD6" },
      { token: "type", foreground: "4EC9B0" },
      { token: "string", foreground: "CE9178" },
      { token: "comment", foreground: "6A9955" },
      { token: "number", foreground: "B5CEA8" },
      { token: "attribute", foreground: "DCDCAA" },
      { token: "identifier", foreground: "D4D4D4" },
    ],
    colors: {
      "editor.background": "#1E1E1E",
      "editor.foreground": "#D4D4D4",
      "editorLineNumber.foreground": "#858585",
      "editor.selectionBackground": "#264F78",
      "editorCursor.foreground": "#AEAFAD",
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

function typeSuggestions(engine: EngineKind): Array<{ label: string; insert: string }> {
  const sized = new Set(["varchar", "nvarchar", "char", "nchar"]);
  const decimal = new Set(["decimal", "numeric"]);
  return engineTypes(engine).map((type) => {
    if (sized.has(type)) return { label: type, insert: `${type}(\${1:50})` };
    if (decimal.has(type)) return { label: type, insert: `${type}(\${1:18}, \${2:0})` };
    return { label: type, insert: type };
  });
}

function plainInsert(insert: string): string {
  return insert.replace(/\$\{\d+:([^}]*)\}/g, "$1");
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
