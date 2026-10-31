import type { Monaco } from "@monaco-editor/react";
import type { editor, Position } from "monaco-editor";
import { format, type SqlLanguage } from "sql-formatter";
import type { EngineKind } from "../types";
import {
  buildSqlSuggestions,
  emptyCatalog,
  SQL_SNIPPETS,
  sqlFunctions,
  type SqlCatalog,
  type SqlSuggestion,
} from "./complete";

export { emptyCatalog, SQL_SNIPPETS, type SqlCatalog };

let catalog: SqlCatalog = emptyCatalog("postgres");
const engines = new WeakMap<editor.ITextModel, EngineKind>();
let registered = false;

export function setSqlCatalog(next: SqlCatalog) {
  catalog = next;
}

export function bindModelEngine(model: editor.ITextModel, engine: EngineKind) {
  engines.set(model, engine);
}

export function executionSql(
  codeEditor: editor.IStandaloneCodeEditor | undefined,
  documentSql: string,
): { sql: string; selected: boolean } {
  const model = codeEditor?.getModel();
  const selection = codeEditor?.getSelection();
  if (!model || !selection || selection.isEmpty()) return { sql: documentSql, selected: false };
  const text = model.getValueInRange(selection).trim();
  if (!text) return { sql: documentSql, selected: false };
  return { sql: text, selected: true };
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

export function bindEditorHistory(codeEditor: editor.IStandaloneCodeEditor): () => void {
  const node = codeEditor.getDomNode();
  if (!node) return () => undefined;
  const onKeyDown = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const undo = event.code === "KeyZ" && !event.shiftKey;
    const redo = (event.code === "KeyY" && !event.shiftKey) || (event.code === "KeyZ" && event.shiftKey);
    if (!undo && !redo) return;
    const target = event.target;
    if (target instanceof HTMLElement && target.closest(".find-widget, .monaco-findInput")) return;
    event.preventDefault();
    event.stopPropagation();
    codeEditor.trigger("keyboard", redo ? "redo" : "undo", null);
  };
  node.addEventListener("keydown", onKeyDown, true);
  return () => node.removeEventListener("keydown", onKeyDown, true);
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
      const suggestions = buildSqlSuggestions({
        sql: model.getValue(),
        offset: model.getOffsetAt(position),
        catalog: { ...catalog, engine },
        snippets: SQL_SNIPPETS,
        functions: sqlFunctions(engine),
      }).map((suggestion) => toCompletion(monaco, range, suggestion));
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

function toCompletion(
  monaco: Monaco,
  range: { startLineNumber: number; endLineNumber: number; startColumn: number; endColumn: number },
  suggestion: SqlSuggestion,
) {
  const kinds = monaco.languages.CompletionItemKind;
  const kind = {
    snippet: kinds.Snippet,
    function: kinds.Function,
    database: kinds.Class,
    schema: kinds.Module,
    table: kinds.Struct,
    view: kinds.Interface,
    column: kinds.Field,
    routine: kinds.Method,
  }[suggestion.kind];
  return {
    label: suggestion.label,
    kind,
    insertText: suggestion.insertText,
    insertTextRules: suggestion.snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    detail: suggestion.detail,
    documentation: suggestion.documentation,
    range,
    sortText: suggestion.sort,
    filterText: suggestion.filterText,
  };
}
