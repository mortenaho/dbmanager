import { invoke } from "@tauri-apps/api/core";
import { resultsToJson, resultsToXlsx } from "./export";
import { getCurrentWindow } from "@tauri-apps/api/window";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  connectServer,
  disconnectServer,
  executeSql,
  askSql,
  listAllColumns,
  listDatabases,
  listObjects,
  loadProfiles,
  parseSql,
  clearHistory,
  rollbackHistory,
  generateScript,
  logEvent,
  renameObject,
  saveProfile,
  scriptRoutine,
} from "./api";
import { schemaText, sqlWithNote } from "./ask";
import { AskDialog } from "./components/AskDialog";
import { ConnectDialog } from "./components/ConnectDialog";
import { DetailsPane, type DetailsTarget } from "./components/DetailsPane";
import { DiagramDesigner } from "./components/DiagramDesigner";
import { TableDesigner } from "./components/TableDesigner";
import { HelpDialog } from "./components/HelpDialog";
import { HistoryDialog } from "./components/HistoryDialog";
import {
  AskIcon,
  BackupIcon,
  CheckIcon,
  CloseAllIcon,
  CloseIcon,
  ConnectIcon,
  DesignIcon,
  DisconnectIcon,
  ExcelIcon,
  ExitIcon,
  ExplorerIcon,
  FormatIcon,
  HistoryIcon,
  InfoIcon,
  InsertIcon,
  JsonIcon,
  KeyboardIcon,
  NewQueryIcon,
  OptionsIcon,
  PlayIcon,
  PlugIcon,
  ScriptIcon,
} from "./components/Icons";
import { ObjectExplorer } from "./components/ObjectExplorer";
import { RenameDialog } from "./components/RenameDialog";
import { SettingsDialog } from "./components/SettingsDialog";
import { ResultsPane } from "./components/ResultsPane";
import {
  bindModelEngine,
  emptyCatalog,
  bindEditorHistory,
  executionSql,
  formatSql,
  insertSnippet,
  registerSqlEditor,
  setSqlCatalog,
  SQL_SNIPPETS,
} from "./sql/editor";
import { SAMPLE_DBML } from "./sql/dbml";
import {
  engineLabel,
  errorText,
  objectTabTitle,
  selectTopSql,
  type Connection,
  type EngineKind,
  type ConnectPayload,
  type DbObject,
  type HistoryDetail,
  type Profile,
  type QueryTab,
  type ResultSet,
} from "./types";

type TableDesignDoc = {
  id: string;
  connectionId: string;
  engine: EngineKind;
  database: string;
  schema: string;
  name: string;
};

type RenameTarget =
  | { kind: "database"; connectionId: string; database: string }
  | { kind: "table"; connectionId: string; database: string; schema: string; name: string };

export default function App() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [tabs, setTabs] = useState<QueryTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [explorerWidth, setExplorerWidth] = useState(280);
  const [resultsHeight, setResultsHeight] = useState(280);
  const [showExplorer, setShowExplorer] = useState(true);
  const [connectOpen, setConnectOpen] = useState(false);
  const [connectSelection, setConnectSelection] = useState<string | null | undefined>(undefined);
  const [connectError, setConnectError] = useState("");
  const [recent, setRecent] = useState<Profile[]>([]);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [aiWidth, setAiWidth] = useState(360);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [details, setDetails] = useState<DetailsTarget | null>(null);
  const [detailsActive, setDetailsActive] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  const [designActive, setDesignActive] = useState(false);
  const [designDbml, setDesignDbml] = useState(SAMPLE_DBML);
  const [designEngine, setDesignEngine] = useState<EngineKind>("postgres");
  const [tableDesigns, setTableDesigns] = useState<TableDesignDoc[]>([]);
  const [tableDesignId, setTableDesignId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [context, setContext] = useState<{ connectionId: string; database: string } | null>(null);
  const [rename, setRename] = useState<RenameTarget | null>(null);
  const [explorerReload, setExplorerReload] = useState(0);
  const [notice, setNotice] = useState("");
  const counter = useRef(0);
  const tabsRef = useRef(tabs);
  const activeRef = useRef(activeTabId);
  const connectionsRef = useRef(connections);
  const contextRef = useRef(context);
  const detailsActiveRef = useRef(false);
  const detailsRef = useRef(details);
  const designActiveRef = useRef(false);
  const designRef = useRef(false);
  const tableDesignRef = useRef<string | null>(null);
  const editors = useRef(new Map<string, Parameters<OnMount>[0]>());
  detailsActiveRef.current = detailsActive;
  detailsRef.current = details;
  designActiveRef.current = designActive;
  designRef.current = designOpen;
  tableDesignRef.current = tableDesignId;
  tabsRef.current = tabs;
  activeRef.current = activeTabId;
  connectionsRef.current = connections;
  contextRef.current = context;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeConnection = connections.find((item) => item.id === activeTab?.connectionId) ?? null;
  const detailsConnection =
    detailsActive && details
      ? connections.find((item) => item.id === details.connection.id) ?? details.connection
      : null;
  const barConnection = detailsConnection ?? activeConnection;
  const barDatabase = detailsConnection ? details?.database ?? "" : activeTab?.database ?? "";
  const askConnection = barConnection ?? connections[0] ?? null;
  const askTarget = askConnection
    ? `${askConnection.name} · ${barDatabase || askConnection.database || "no database"}`
    : "";

  useEffect(() => {
    editors.current.get(activeTabId ?? "")?.layout();
  }, [activeTabId, resultsHeight, explorerWidth, showExplorer, askOpen, aiWidth]);

  useEffect(() => {
    loadProfiles()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    const connection = connections.find((item) => item.id === tab?.connectionId);
    const tableDesign = tableDesigns.find((doc) => doc.id === tableDesignId);
    const tableTitle = tableDesign ? (tableDesign.name ? objectTabTitle(tableDesign.engine, tableDesign.schema, tableDesign.name) : "New Table") : "";
    const title = tableDesign
      ? `${tableTitle} - DB Manager`
      : designActive
        ? "Database Design - DB Manager"
        : tab
          ? `${tab.title}${connection ? ` - ${connection.host}` : ""} - DB Manager`
          : "DB Manager";
    try {
      void getCurrentWindow().setTitle(title).catch(() => undefined);
    } catch {
      return;
    }
  }, [tabs, activeTabId, connections, designActive, tableDesignId, tableDesigns]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (settingsOpen) setSettingsOpen(false);
        else if (helpOpen) setHelpOpen(false);
        else if (aboutOpen) setAboutOpen(false);
        else if (historyOpen) setHistoryOpen(false);
        else if (rename) setRename(null);
        else if (connectOpen) setConnectOpen(false);
        return;
      }
      if (event.key === "F1") {
        event.preventDefault();
        setHelpOpen((open) => !open);
        return;
      }
      if (connectOpen || aboutOpen || rename || historyOpen || settingsOpen || helpOpen) return;
      const typing = event.target instanceof HTMLElement && (event.target.tagName === "INPUT" || event.target.tagName === "TEXTAREA");
      if (event.key === "F5" && event.ctrlKey) {
        event.preventDefault();
        void parseRef.current();
      } else if (event.key === "F5" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e")) {
        event.preventDefault();
        void runRef.current();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newQueryRef.current();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "w" && !typing) {
        event.preventDefault();
        if (tableDesignRef.current) closeTab(tableDesignRef.current);
        else if (designActiveRef.current) closeTab("design");
        else if (detailsActiveRef.current) closeTab("details");
        else if (activeRef.current) closeTab(activeRef.current);
      } else if (event.shiftKey && event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        formatRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectOpen, aboutOpen, helpOpen, rename, historyOpen, settingsOpen]);

  function makeTab(connectionId: string | null, database: string, sql = "", title = ""): QueryTab {
    const custom = title.trim();
    if (!custom) counter.current += 1;
    return {
      id: crypto.randomUUID(),
      title: custom || `SQLQuery${counter.current}.sql`,
      sql,
      connectionId,
      database,
      resultSets: [],
      messages: [],
      elapsedMs: null,
      running: false,
      activePane: "results",
      line: 1,
      column: 1,
    };
  }

  function chooseConnection(): { connectionId: string | null; database: string } {
    if (contextRef.current && connectionsRef.current.some((item) => item.id === contextRef.current?.connectionId)) {
      return contextRef.current;
    }
    const current = tabsRef.current.find((tab) => tab.id === activeRef.current);
    if (current?.connectionId) return { connectionId: current.connectionId, database: current.database };
    const first = connectionsRef.current[0];
    return { connectionId: first?.id ?? null, database: first?.database ?? "" };
  }

  function openTab(connectionId: string | null, database: string, sql = "", title = "") {
    const tab = makeTab(connectionId, database, sql, title);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setDetailsActive(false);
    setDesignActive(false);
    setTableDesignId(null);
    setMenu(null);
  }

  function openTableDesign(connectionId: string, database: string, schema: string, name: string) {
    const engine = connectionsRef.current.find((item) => item.id === connectionId)?.engine ?? "mssql";
    const existing = name
      ? tableDesigns.find((doc) => doc.connectionId === connectionId && doc.database === database && doc.schema === schema && doc.name === name)
      : undefined;
    const id = existing?.id ?? `td:${counter.current}`;
    if (!existing) {
      counter.current += 1;
      setTableDesigns((current) => [...current, { id, connectionId, engine, database, schema, name }]);
    }
    setTableDesignId(id);
    setDesignActive(false);
    setDetailsActive(false);
    setMenu(null);
  }

  function openDesign() {
    if (!designOpen) {
      const current = tabsRef.current.find((tab) => tab.id === activeRef.current);
      const connection = connectionsRef.current.find((item) => item.id === current?.connectionId) ?? connectionsRef.current[0];
      if (connection) setDesignEngine(connection.engine);
    }
    setDesignOpen(true);
    setDesignActive(true);
    setDetailsActive(false);
    setTableDesignId(null);
    setMenu(null);
  }

  function newQuery(connectionId?: string, database?: string) {
    if (connectionId) {
      openTab(connectionId, database ?? "");
      return;
    }
    const chosen = chooseConnection();
    if (!chosen.connectionId) {
      openConnect();
      return;
    }
    openTab(chosen.connectionId, chosen.database);
  }

  function closeTab(id: string) {
    if (id.startsWith("td:")) {
      setTableDesigns((current) => current.filter((doc) => doc.id !== id));
      setTableDesignId((active) => (active === id ? null : active));
      return;
    }
    if (id === "design") {
      setDesignOpen(false);
      setDesignActive(false);
      if (tabsRef.current.length === 0 && detailsRef.current) setDetailsActive(true);
      return;
    }
    if (id === "details") {
      setDetails(null);
      setDetailsActive(false);
      if (tabsRef.current.length === 0 && designRef.current) setDesignActive(true);
      return;
    }
    editors.current.delete(id);
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      setActiveTabId((active) => {
        if (active !== id) return active;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      if (next.length === 0) {
        if (designRef.current) setDesignActive(true);
        else if (detailsRef.current) setDetailsActive(true);
      }
      return next;
    });
  }

  function closeTabs(keepId: string | null) {
    if (keepId?.startsWith("td:")) {
      setTableDesigns((current) => current.filter((doc) => doc.id === keepId));
      setTableDesignId(keepId);
    } else {
      setTableDesigns([]);
      setTableDesignId(null);
    }
    if (keepId === "design") setDesignActive(true);
    else {
      setDesignOpen(false);
      setDesignActive(false);
    }
    if (keepId !== "details") {
      setDetails(null);
      setDetailsActive(false);
    } else {
      setDetailsActive(true);
    }
    setTabs((current) => {
      const next = keepId === null ? [] : current.filter((tab) => tab.id === keepId);
      const keep = new Set(next.map((tab) => tab.id));
      for (const tab of current) {
        if (!keep.has(tab.id)) editors.current.delete(tab.id);
      }
      setActiveTabId(keepId !== null && next.some((tab) => tab.id === keepId) ? keepId : null);
      return next;
    });
  }

  function patchTab(id: string, patch: Partial<QueryTab>) {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }

  async function runQuery() {
    if (detailsActiveRef.current || designActiveRef.current || tableDesignRef.current) return;
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab || tab.running) return;
    if (!tab.connectionId) {
      openConnect();
      return;
    }
    const target = executionSql(editors.current.get(tab.id), tab.sql);
    patchTab(tab.id, { running: true, messages: [], resultSets: [], activePane: "results" });
    const started = performance.now();
    try {
      const response = await executeSql(tab.connectionId, tab.database, target.sql);
      if (target.selected) {
        response.messages = [{ level: "info", text: "Executed the selected text." }, ...response.messages];
      }
      const failed = response.messages.some((message) => message.level === "error");
      const hasGrid = response.resultSets.some((set) => set.columns.length > 0);
      const guard = hasGrid ? undefined : response.messages.find((message) => message.level === "warn");
      patchTab(tab.id, {
        running: false,
        resultSets: response.resultSets,
        messages: response.messages,
        elapsedMs: response.elapsedMs,
        activePane: failed || guard ? "messages" : "results",
      });
      if (guard) showNotice(guard.text.split("\n")[0]);
      const backedUp = response.messages.find((message) => message.text.startsWith("Backed up rows"));
      if (backedUp) showNotice(backedUp.text);
    } catch (reason) {
      patchTab(tab.id, {
        running: false,
        resultSets: [],
        elapsedMs: Math.round(performance.now() - started),
        activePane: "messages",
        messages: [{ level: "error", text: errorText(reason) }],
      });
    }
  }

  async function parseQuery() {
    if (detailsActiveRef.current || designActiveRef.current || tableDesignRef.current) return;
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab || tab.running) return;
    if (!tab.connectionId) {
      openConnect();
      return;
    }
    const target = executionSql(editors.current.get(tab.id), tab.sql);
    patchTab(tab.id, { running: true });
    try {
      const response = await parseSql(tab.connectionId, tab.database, target.sql);
      if (target.selected) {
        response.messages = [{ level: "info", text: "Parsed the selected text." }, ...response.messages];
      }
      patchTab(tab.id, {
        running: false,
        messages: response.messages,
        elapsedMs: response.elapsedMs,
        activePane: "messages",
      });
    } catch (reason) {
      patchTab(tab.id, {
        running: false,
        activePane: "messages",
        messages: [{ level: "error", text: errorText(reason) }],
      });
    }
  }

  function formatQuery() {
    if (detailsActiveRef.current || designActiveRef.current || tableDesignRef.current) return;
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab) return;
    const engine = connectionsRef.current.find((item) => item.id === tab.connectionId)?.engine ?? "postgres";
    try {
      const next = formatSql(tab.sql, engine);
      const editor = editors.current.get(tab.id);
      const model = editor?.getModel();
      if (editor && model) {
        editor.executeEdits("format", [{ range: model.getFullModelRange(), text: next }]);
      } else {
        patchTab(tab.id, { sql: next });
      }
    } catch (reason) {
      patchTab(tab.id, {
        activePane: "messages",
        messages: [{ level: "error", text: errorText(reason) }],
      });
    }
  }

  function insertQuerySnippet(snippet: string) {
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    const editor = tab ? editors.current.get(tab.id) : undefined;
    if (!editor) return;
    insertSnippet(editor, snippet);
  }

  function showNotice(text: string) {
    setNotice(text);
    window.setTimeout(() => setNotice((current) => (current === text ? "" : current)), 8000);
  }

  async function applyRename(target: RenameTarget, newName: string) {
    const message = await renameObject(
      target.connectionId,
      target.kind,
      target.database,
      target.kind === "table" ? target.schema : "",
      target.kind === "table" ? target.name : target.database,
      newName,
    );
    if (target.kind === "database") {
      setConnections((current) =>
        current.map((connection) => {
          if (connection.id !== target.connectionId) return connection;
          return {
            ...connection,
            database: connection.database === target.database ? newName : connection.database,
            databases: connection.databases.map((database) => (database === target.database ? newName : database)),
          };
        }),
      );
      setTabs((current) =>
        current.map((tab) =>
          tab.connectionId === target.connectionId && tab.database === target.database
            ? { ...tab, database: newName }
            : tab,
        ),
      );
      setContext((current) =>
        current && current.connectionId === target.connectionId && current.database === target.database
          ? { ...current, database: newName }
          : current,
      );
    }
    setExplorerReload((value) => value + 1);
    setRename(null);
    showNotice(message);
  }

  function routineTitle(connectionId: string, object: DbObject): string {
    const engine = connectionsRef.current.find((item) => item.id === connectionId)?.engine ?? "postgres";
    return objectTabTitle(engine, object.schema, object.name);
  }

  async function openRoutine(connectionId: string, database: string, object: DbObject) {
    const title = routineTitle(connectionId, object);
    try {
      const sql = await scriptRoutine(connectionId, database, object.schema, object.name, object.kind);
      openTab(connectionId, database, sql.endsWith("\n") ? sql : `${sql}\n`, title);
    } catch (reason) {
      openTab(connectionId, database, `-- ${errorText(reason)}\n`, title);
    }
  }

  const scriptingRef = useRef(false);

  function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const size = 0x8000;
    for (let index = 0; index < bytes.length; index += size) {
      binary += String.fromCharCode(...bytes.subarray(index, index + size));
    }
    return btoa(binary);
  }

  async function saveSqlFile(fileName: string, contents: string): Promise<"saved" | "cancelled"> {
    return saveFile(fileName, contents, { name: "SQL script", extensions: ["sql"] });
  }

  async function saveFile(
    fileName: string,
    contents: string | Uint8Array,
    filter: { name: string; extensions: string[] },
  ): Promise<"saved" | "cancelled"> {
    const tauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    if (!tauri) {
      const blob = new Blob(
        typeof contents === "string" ? [contents] : [Uint8Array.from(contents).buffer],
        { type: typeof contents === "string" ? "text/plain;charset=utf-8" : "application/octet-stream" },
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      return "saved";
    }
    const path = await invoke<string | null>("plugin:dialog|save", {
      options: {
        defaultPath: fileName,
        filters: [filter],
      },
    });
    if (!path) return "cancelled";
    if (typeof contents === "string") {
      await invoke("write_text_file", { path, contents });
    } else {
      await invoke("write_binary_file", { path, contentsBase64: bytesToBase64(contents) });
    }
    return "saved";
  }

  async function openTextFile(): Promise<{ name: string; contents: string } | null> {
    const tauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    if (!tauri) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".dbdesign,.dbml,.json,text/plain";
        let settled = false;
        const finish = (value: { name: string; contents: string } | null) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        input.onchange = () => {
          const file = input.files?.[0];
          if (!file) {
            finish(null);
            return;
          }
          void file.text().then((contents) => finish({ name: file.name, contents })).catch(() => finish(null));
        };
        input.addEventListener("cancel", () => finish(null));
        input.click();
      });
    }
    const picked = await invoke<string | null>("plugin:dialog|open", {
      options: {
        title: "Open Database Design",
        multiple: false,
        directory: false,
        filters: [{ name: "Database design", extensions: ["dbdesign", "dbml"] }],
      },
    });
    if (!picked) return null;
    const contents = await invoke<string>("read_text_file", { path: picked });
    const name = picked.split(/[/\\]/).pop() || "DatabaseDesign.dbdesign";
    return { name, contents };
  }

  async function exportSets(format: "xlsx" | "json", sets: ResultSet[], title: string) {
    const grids = sets.filter((set) => set.columns.length > 0);
    if (grids.length === 0) {
      showNotice("There is no result set to save.");
      return;
    }
    const base = (title || "results").replace(/\.sql$/i, "").replace(/[\\/:*?"<>|]/g, "_") || "results";
    try {
      const saved =
        format === "json"
          ? await saveFile(`${base}.json`, resultsToJson(grids), { name: "JSON", extensions: ["json"] })
          : await saveFile(`${base}.xlsx`, resultsToXlsx(grids), { name: "Excel workbook", extensions: ["xlsx"] });
      if (saved === "saved") {
        showNotice(format === "json" ? "Results saved as JSON." : "Results saved as Excel.");
        void logEvent("info", "export", `Saved results as ${format.toUpperCase()}.`).catch(() => undefined);
      }
    } catch (reason) {
      showNotice(errorText(reason));
    }
  }

  function exportResults(format: "xlsx" | "json") {
    if (!activeTab) return;
    void exportSets(format, activeTab.resultSets, activeTab.title);
  }

  async function clearSavedHistory() {
    if (!window.confirm("Delete all saved queries, row backups, results, and logs?")) return;
    try {
      await clearHistory();
      setHistoryVersion((value) => value + 1);
      showNotice("History cleared.");
    } catch (reason) {
      showNotice(errorText(reason));
    }
  }

  async function rollbackSaved(detail: HistoryDetail) {
    const matches = connections.filter(
      (item) => item.engine === detail.engine && `${item.host}:${item.port}` === detail.server,
    );
    const connection = matches.find((item) => item.id === activeTab?.connectionId) ?? matches[0];
    if (!connection) {
      throw new Error(`Connect to ${detail.server} before rolling back this change.`);
    }
    const response = await rollbackHistory(connection.id, detail.id);
    setHistoryVersion((value) => value + 1);
    const failed = response.messages.find((message) => message.level === "error");
    if (failed) throw new Error(failed.text);
    showNotice(response.messages[0]?.text ?? "Restored the backed-up rows.");
  }

  async function runGenerate(
    connectionId: string,
    database: string,
    object: DbObject | null,
    mode: "create" | "insert" | "both" | "schema" | "backup",
  ) {
    if (scriptingRef.current) return;
    scriptingRef.current = true;
    const backup = mode === "backup";
    showNotice(backup ? "Creating backup..." : "Generating script...");
    try {
      const result = await generateScript(
        connectionId,
        database,
        object?.schema ?? "",
        object?.name ?? database,
        object?.kind ?? "database",
        mode !== "insert",
        mode === "insert" || mode === "both" || backup,
      );
      const notes = result.warnings.length ? `\n-- ${result.warnings.join("\n-- ")}\n` : "";
      const sql = `${result.sql}${notes}`;
      const fileName = object ? `${object.name}.sql` : `${database}-${backup ? "backup" : "script"}.sql`;
      if (backup || sql.length > 1_500_000) {
        const saved = await saveSqlFile(fileName, sql);
        showNotice(
          saved === "cancelled"
            ? "Save cancelled."
            : result.warnings.length
              ? `Saved ${fileName} with ${result.warnings.length} warning(s).`
              : `Saved ${fileName}.`,
        );
      } else {
        const kind = object?.kind.toLowerCase() ?? "";
        const title =
          object && (kind === "view" || kind === "procedure" || kind === "function")
            ? routineTitle(connectionId, object)
            : "";
        openTab(connectionId, database, sql.endsWith("\n") ? sql : `${sql}\n`, title);
        if (result.warnings.length) {
          showNotice(`Script opened with ${result.warnings.length} warning(s).`);
        }
      }
    } catch (reason) {
      showNotice(errorText(reason));
    } finally {
      scriptingRef.current = false;
    }
  }

  const runRef = useRef(runQuery);
  const parseRef = useRef(parseQuery);
  const formatRef = useRef(formatQuery);
  const newQueryRef = useRef(() => newQuery());
  runRef.current = runQuery;
  parseRef.current = parseQuery;
  formatRef.current = formatQuery;
  newQueryRef.current = () => newQuery();

  function openConnect(selection?: string | null) {
    setConnectSelection(selection);
    setConnectError("");
    setConnectOpen(true);
  }

  async function quickConnect(profile: Profile) {
    if (!profile.password) {
      openConnect(profile.id);
      return;
    }
    setConnectingId(profile.id);
    try {
      const saved = await saveProfile(profile);
      await handleConnect(
        {
          engine: saved.engine,
          name: saved.name,
          host: saved.host,
          port: saved.port,
          username: saved.username,
          password: profile.password,
          database: saved.database,
          trustCert: saved.trustCert,
          encrypt: saved.encrypt,
          ssl: saved.ssl,
        },
        saved,
      );
    } catch (reason) {
      setConnectSelection(profile.id);
      setConnectError(errorText(reason));
      setConnectOpen(true);
    } finally {
      setConnectingId(null);
    }
  }

  async function handleConnect(payload: ConnectPayload, profile: Profile) {
    void profile;
    const connection = await connectServer(payload);
    setConnections((current) => [...current, connection]);
    setContext({ connectionId: connection.id, database: connection.database });
    setConnectOpen(false);
    setConnectError("");
    openTab(connection.id, connection.database);
    loadProfiles()
      .then(setRecent)
      .catch(() => undefined);
  }

  async function refreshConnection(id: string) {
    try {
      const databases = await listDatabases(id);
      setConnections((current) =>
        current.map((connection) => (connection.id === id ? { ...connection, databases } : connection)),
      );
    } catch (reason) {
      const tab = tabsRef.current.find((item) => item.id === activeRef.current);
      if (tab) {
        patchTab(tab.id, {
          activePane: "messages",
          messages: [{ level: "error", text: errorText(reason) }],
        });
      }
    }
  }

  async function disconnect(id: string) {
    await disconnectServer(id).catch(() => undefined);
    setConnections((current) => current.filter((connection) => connection.id !== id));
    if (context?.connectionId === id) setContext(null);
  }

  function startDrag(kind: "explorer" | "results" | "ai", event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = explorerWidth;
    const startHeight = resultsHeight;
    const startAi = aiWidth;
    const move = (ev: MouseEvent) => {
      if (kind === "explorer") {
        setExplorerWidth(Math.min(560, Math.max(200, startWidth + ev.clientX - startX)));
      } else if (kind === "ai") {
        setAiWidth(Math.min(640, Math.max(280, startAi - (ev.clientX - startX))));
      } else {
        setResultsHeight(Math.min(window.innerHeight - 220, Math.max(110, startHeight - (ev.clientY - startY))));
      }
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  }

  useEffect(() => {
    const connectionId = activeTab?.connectionId;
    const database = activeTab?.database ?? "";
    const connection = connections.find((item) => item.id === connectionId);
    const engine = connection?.engine;
    if (!connectionId || !database || !engine) {
      setSqlCatalog(emptyCatalog(engine ?? "postgres"));
      return;
    }
    const known = connection?.databases ?? [];
    const databases =
      database && !known.some((item) => item.toLowerCase() === database.toLowerCase()) ? [database, ...known] : known;
    let cancel = false;
    Promise.all([listObjects(connectionId, database), listAllColumns(connectionId, database)])
      .then(([objects, columns]) => {
        if (cancel) return;
        setSqlCatalog({
          engine,
          database,
          databases,
          tables: objects.filter((object) => object.kind === "table" || object.kind === "view"),
          routines: objects.filter((object) => object.kind === "procedure" || object.kind === "function"),
          columns,
        });
      })
      .catch(() => {
        if (!cancel) setSqlCatalog(emptyCatalog(engine));
      });
    return () => {
      cancel = true;
    };
  }, [activeTab?.connectionId, activeTab?.database, connections, explorerReload]);

  useEffect(() => {
    for (const tab of tabs) {
      const model = editors.current.get(tab.id)?.getModel();
      const engine = connections.find((item) => item.id === tab.connectionId)?.engine;
      if (model && engine) bindModelEngine(model, engine);
    }
  }, [tabs, connections]);

  const beforeMount: BeforeMount = (monaco) => {
    registerSqlEditor(monaco);
    monaco.editor.defineTheme("ssms", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "keyword", foreground: "0000FF" },
        { token: "string", foreground: "A31515" },
        { token: "comment", foreground: "008000" },
        { token: "number", foreground: "098658" },
      ],
      colors: {
        "editor.background": "#FFFFFF",
        "editor.foreground": "#000000",
        "editorLineNumber.foreground": "#2B91AF",
        "editor.selectionBackground": "#ADD6FF",
        "editorCursor.foreground": "#000000",
      },
    });
  };

  const rowCount = activeTab?.resultSets.reduce((sum, set) => sum + set.rows.length, 0) ?? 0;
  const editorLocked = detailsActive || designActive || tableDesignId !== null;
  const activeTableDesign = tableDesigns.find((doc) => doc.id === tableDesignId) ?? null;

  return (
    <div
      className="ssms"
      onMouseDown={() => {
        setMenu(null);
        setTabMenu(null);
      }}
    >
      <div className="menu-bar">
        <Menu
          label="File"
          open={menu === "File"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "File" ? null : "File")}
          onHover={() => setMenu("File")}
          onDismiss={() => setMenu(null)}
          items={[
            { label: "New Query", hint: "Ctrl+N", icon: <NewQueryIcon />, action: () => newQuery() },
            { label: "Connect...", hint: "", icon: <PlugIcon />, action: () => openConnect() },
            ...recent.slice(0, 5).map((profile) => ({
              label: `Connect to ${profile.name}`,
              hint: engineLabel(profile.engine),
              icon: <ConnectIcon />,
              disabled: connectingId !== null,
              action: () => void quickConnect(profile),
            })),
            {
              label: "Generate Scripts",
              hint: "",
              icon: <ScriptIcon />,
              disabled: !activeTab?.connectionId || !activeTab.database,
              action: () => {
                if (activeTab?.connectionId && activeTab.database) {
                  void runGenerate(activeTab.connectionId, activeTab.database, null, "schema");
                }
              },
            },
            {
              label: "Backup Database",
              hint: "",
              icon: <BackupIcon />,
              disabled: !activeTab?.connectionId || !activeTab.database,
              action: () => {
                if (activeTab?.connectionId && activeTab.database) {
                  void runGenerate(activeTab.connectionId, activeTab.database, null, "backup");
                }
              },
            },
            {
              label: "Disconnect",
              hint: "",
              icon: <DisconnectIcon />,
              disabled: !activeConnection,
              action: () => activeConnection && void disconnect(activeConnection.id),
            },
            {
              label: "Close",
              hint: "Ctrl+W",
              icon: <CloseIcon />,
              disabled: !activeTab,
              action: () => activeTab && closeTab(activeTab.id),
            },
            { label: "sep" },
            {
              label: "Exit",
              hint: "",
              icon: <ExitIcon />,
              action: () => {
                try {
                  void getCurrentWindow().close();
                } catch {
                  window.close();
                }
              },
            },
          ]}
        />
        <Menu
          label="View"
          open={menu === "View"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "View" ? null : "View")}
          onHover={() => setMenu("View")}
          onDismiss={() => setMenu(null)}
          items={[
            {
              label: showExplorer ? "Hide Object Explorer" : "Object Explorer",
              hint: "",
              icon: <ExplorerIcon />,
              action: () => setShowExplorer((value) => !value),
            },
            { label: "History", hint: "", icon: <HistoryIcon />, action: () => setHistoryOpen(true) },
          ]}
        />
        <Menu
          label="Query"
          open={menu === "Query"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "Query" ? null : "Query")}
          onHover={() => setMenu("Query")}
          onDismiss={() => setMenu(null)}
          items={[
            { label: "Execute", hint: "F5", icon: <PlayIcon />, disabled: editorLocked || !activeTab || activeTab.running, action: () => void runQuery() },
            {
              label: "Parse",
              hint: "Ctrl+F5",
              icon: <CheckIcon />,
              disabled: editorLocked || !activeTab || activeTab.running,
              action: () => void parseQuery(),
            },
            {
              label: "Format SQL",
              hint: "Shift+Alt+F",
              icon: <FormatIcon />,
              disabled: editorLocked || !activeTab,
              action: () => formatQuery(),
            },
            { label: "sep" },
            {
              label: "Save Results as Excel",
              hint: "",
              icon: <ExcelIcon />,
              disabled: !activeTab?.resultSets.some((set) => set.columns.length > 0),
              action: () => void exportResults("xlsx"),
            },
            {
              label: "Save Results as JSON",
              hint: "",
              icon: <JsonIcon />,
              disabled: !activeTab?.resultSets.some((set) => set.columns.length > 0),
              action: () => void exportResults("json"),
            },
            { label: "sep" },
            ...SQL_SNIPPETS.filter((snippet) =>
              ["select", "ins", "upd", "join", "createproc"].includes(snippet.label),
            ).map((snippet) => ({
              label: `Insert ${snippet.detail}`,
              hint: "",
              icon: <InsertIcon />,
              disabled: editorLocked || !activeTab,
              action: () => insertQuerySnippet(snippet.insertText),
            })),
          ]}
        />
        <Menu
          label="Tools"
          open={menu === "Tools"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "Tools" ? null : "Tools")}
          onHover={() => setMenu("Tools")}
          onDismiss={() => setMenu(null)}
          items={[
            { label: "Database Design", hint: "", icon: <DesignIcon />, action: () => openDesign() },
            { label: "sep" },
            { label: "Options...", hint: "", icon: <OptionsIcon />, action: () => setSettingsOpen(true) },
          ]}
        />
        <Menu
          label="Help"
          open={menu === "Help"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "Help" ? null : "Help")}
          onHover={() => setMenu("Help")}
          onDismiss={() => setMenu(null)}
          items={[
            { label: "Keyboard Shortcuts", hint: "F1", icon: <KeyboardIcon />, action: () => setHelpOpen(true) },
            { label: "sep" },
            { label: "About DB Manager", hint: "", icon: <InfoIcon />, action: () => setAboutOpen(true) },
          ]}
        />
        <button
          type="button"
          className={askOpen ? "menu-ai on" : "menu-ai"}
          aria-expanded={askOpen}
          onClick={() => {
            setMenu(null);
            setAskOpen((open) => !open);
          }}
        >
          AI
        </button>
      </div>

      <div className="toolbar">
        <button className="tool" title="Connect" onClick={() => openConnect()}>
          <PlugIcon />
        </button>
        <button className="tool" title="New Query (Ctrl+N)" onClick={() => newQuery()}>
          <NewQueryIcon />
        </button>
        <span className="tool-sep" />
        <button className="tool primary" title="Execute (F5). Runs the highlighted text, or the whole script when nothing is selected." disabled={editorLocked || !activeTab || activeTab.running} onMouseDown={(event) => event.preventDefault()} onClick={() => void runQuery()}>
          <PlayIcon />
          <span>Execute</span>
        </button>
        <button className="tool" title="Parse (Ctrl+F5). Checks the highlighted text, or the whole script when nothing is selected." disabled={editorLocked || !activeTab || activeTab.running} onMouseDown={(event) => event.preventDefault()} onClick={() => void parseQuery()}>
          <CheckIcon />
        </button>
        <button className="tool" title="Format SQL (Shift+Alt+F)" disabled={editorLocked || !activeTab} onClick={() => formatQuery()}>
          <FormatIcon />
        </button>
        <button
          className={askOpen ? "tool on" : "tool"}
          title="AI"
          aria-expanded={askOpen}
          onClick={() => setAskOpen((open) => !open)}
        >
          <AskIcon />
          <span>AI</span>
        </button>
        <span className="tool-sep" />
        <select
          className="conn-select"
          value={detailsConnection ? detailsConnection.id : activeTab?.connectionId ?? ""}
          disabled={!activeTab && !detailsConnection}
          onChange={(event) => {
            if (!activeTab) return;
            const connection = connections.find((item) => item.id === event.target.value);
            patchTab(activeTab.id, {
              connectionId: connection?.id ?? null,
              database: connection?.database ?? "",
            });
          }}
        >
          <option value="">Not connected</option>
          {connections.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name} ({engineLabel(connection.engine)})
            </option>
          ))}
        </select>
        <select
          className="db-select"
          value={barDatabase}
          disabled={!barConnection}
          onChange={(event) => activeTab && !editorLocked && patchTab(activeTab.id, { database: event.target.value })}
        >
          {(barConnection?.databases ?? []).map((database) => (
            <option key={database} value={database}>
              {database}
            </option>
          ))}
          {barDatabase && !barConnection?.databases.includes(barDatabase) ? (
            <option value={barDatabase}>{barDatabase}</option>
          ) : null}
        </select>
        <span className="spacer" />
        <span className="server-chip">
          {barConnection
            ? `${barConnection.username}@${barConnection.host},${barConnection.port}`
            : "Disconnected"}
        </span>
      </div>

      <div className="workspace">
        {showExplorer ? (
          <>
            <ObjectExplorer
              width={explorerWidth}
              connections={connections}
              filter={filter}
              reloadKey={explorerReload}
              onFilter={setFilter}
              onConnect={() => openConnect()}
              onDisconnect={(id) => void disconnect(id)}
              onRefresh={(id) => void refreshConnection(id)}
              onNewQuery={(connectionId, database) => newQuery(connectionId, database)}
              onSelectTop={(connectionId, database, sql, title) => openTab(connectionId, database, sql, title)}
              onSelectContext={(connectionId, database) =>
                setContext((current) =>
                  current?.connectionId === connectionId && current.database === database
                    ? current
                    : { connectionId, database },
                )
              }
              onRenameDatabase={(connectionId, database) =>
                setRename({ kind: "database", connectionId, database })
              }
              onRenameTable={(connectionId, database, schema, name) =>
                setRename({ kind: "table", connectionId, database, schema, name })
              }
              onDesignTable={(connectionId, database, schema, name) => openTableDesign(connectionId, database, schema, name)}
              onScriptRoutine={(connectionId, database, object) => void openRoutine(connectionId, database, object)}
              onGenerateScript={(connectionId, database, object, mode) =>
                void runGenerate(connectionId, database, object, mode)
              }
              onShowDetails={(target) => {
                setDetails(target);
                setDetailsActive(true);
                setDesignActive(false);
                setTableDesignId(null);
              }}
            />
            <div className="splitter-v" onMouseDown={(event) => startDrag("explorer", event)} />
          </>
        ) : null}
        <section className="document">
          {tabs.length === 0 && !details && !designOpen && tableDesigns.length === 0 ? (
            <div className="blank">
              <div className="blank-card">
                <div className="blank-brand">
                  <img className="app-logo" src="/logo.png" alt="" width={48} height={48} />
                  <h1>DB Manager</h1>
                </div>
                <p>Connect to SQL Server, PostgreSQL, or MySQL, then write a query and press F5.</p>
                <div className="blank-actions">
                  {recent[0] ? (
                    <button className="big" disabled={connectingId !== null} onClick={() => void quickConnect(recent[0])}>
                      <ConnectIcon />
                      <span>{connectingId === recent[0].id ? "Connecting..." : `Connect to ${recent[0].name}`}</span>
                    </button>
                  ) : (
                    <button className="big" onClick={() => openConnect(null)}>
                      <ConnectIcon />
                      <span>Connect</span>
                    </button>
                  )}
                  {recent.slice(1, 5).map((profile) => (
                    <button key={profile.id} type="button" disabled={connectingId !== null} onClick={() => void quickConnect(profile)}>
                      <span className="menu-label">
                        <ConnectIcon />
                        <span>{profile.name}</span>
                      </span>
                      <span className="meta">{engineLabel(profile.engine)}</span>
                    </button>
                  ))}
                  {recent.length > 0 ? (
                    <button className="quiet" type="button" onClick={() => openConnect(null)}>
                      <PlugIcon />
                      <span>New connection</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="doc-tabs">
                {tableDesigns.map((doc) => (
                  <div
                    key={doc.id}
                    className={`doc-tab ${doc.id === tableDesignId ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      if (event.button === 1) {
                        event.preventDefault();
                        return;
                      }
                      if (event.button !== 0) return;
                      setTableDesignId(doc.id);
                      setDesignActive(false);
                      setDetailsActive(false);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      closeTab(doc.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setTableDesignId(doc.id);
                      setDesignActive(false);
                      setDetailsActive(false);
                      setTabMenu({ x: event.clientX, y: event.clientY, id: doc.id });
                    }}
                  >
                    <span title={doc.name ? objectTabTitle(doc.engine, doc.schema, doc.name) : "New Table"}>
                      {doc.name ? objectTabTitle(doc.engine, doc.schema, doc.name) : "New Table"}
                    </span>
                    <button
                      className="close"
                      title="Close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(doc.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {designOpen ? (
                  <div
                    className={`doc-tab ${designActive ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      if (event.button === 1) {
                        event.preventDefault();
                        return;
                      }
                      if (event.button !== 0) return;
                      setDesignActive(true);
                      setDetailsActive(false);
                      setTableDesignId(null);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      closeTab("design");
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDesignActive(true);
                      setDetailsActive(false);
                      setTableDesignId(null);
                      setTabMenu({ x: event.clientX, y: event.clientY, id: "design" });
                    }}
                  >
                    <span title="Database Design">Database Design</span>
                    <button
                      className="close"
                      title="Close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab("design");
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                {details ? (
                  <div
                    className={`doc-tab ${detailsActive ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      if (event.button === 1) {
                        event.preventDefault();
                        return;
                      }
                      if (event.button !== 0) return;
                      setDetailsActive(true);
                      setDesignActive(false);
                      setTableDesignId(null);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      closeTab("details");
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDetailsActive(true);
                      setDesignActive(false);
                      setTableDesignId(null);
                      setTabMenu({ x: event.clientX, y: event.clientY, id: "details" });
                    }}
                  >
                    <span title="Object Explorer Details">Object Explorer Details</span>
                    <button
                      className="close"
                      title="Close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab("details");
                      }}
                    >
                      ×
                    </button>
                  </div>
                ) : null}
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`doc-tab ${!editorLocked && tab.id === activeTabId ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      if (event.button === 1) {
                        event.preventDefault();
                        return;
                      }
                      if (event.button !== 0) return;
                      setDetailsActive(false);
                      setDesignActive(false);
                      setTableDesignId(null);
                      setActiveTabId(tab.id);
                    }}
                    onAuxClick={(event) => {
                      if (event.button !== 1) return;
                      event.preventDefault();
                      event.stopPropagation();
                      closeTab(tab.id);
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setDetailsActive(false);
                      setDesignActive(false);
                      setTableDesignId(null);
                      setActiveTabId(tab.id);
                      setTabMenu({ x: event.clientX, y: event.clientY, id: tab.id });
                    }}
                  >
                    <span title={tab.title}>{tab.title}</span>
                    <button
                      className="close"
                      title="Close"
                      onClick={(event) => {
                        event.stopPropagation();
                        closeTab(tab.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              {activeTableDesign ? (
                <TableDesigner
                  connectionId={activeTableDesign.connectionId}
                  engine={activeTableDesign.engine}
                  database={activeTableDesign.database}
                  schema={activeTableDesign.schema}
                  name={activeTableDesign.name}
                  onSaved={(schema, name) => {
                    setTableDesigns((current) =>
                      current.map((doc) => (doc.id === activeTableDesign.id ? { ...doc, schema, name } : doc)),
                    );
                    setExplorerReload((value) => value + 1);
                  }}
                />
              ) : designOpen && designActive ? (
                <DiagramDesigner
                  dbml={designDbml}
                  engine={designEngine}
                  onDbml={setDesignDbml}
                  onEngine={setDesignEngine}
                  onSaveFile={(fileName, contents) =>
                    saveFile(fileName, contents, { name: "Database design", extensions: ["dbdesign"] })
                  }
                  onOpenFile={openTextFile}
                  onImplement={(sql) => {
                    const current = tabs.find((tab) => tab.id === activeTabId);
                    const connection = connections.find((item) => item.id === current?.connectionId) ?? connections[0] ?? null;
                    openTab(connection?.id ?? null, connection?.database ?? "", sql, "CreateSchema.sql");
                  }}
                />
              ) : details && detailsActive ? (
                <DetailsPane
                  target={details}
                  onOpen={(object) => {
                    if (!details.connection.id) return;
                    if (details.folder === "procedure" || details.folder === "function") {
                      void openRoutine(details.connection.id, details.database, object);
                    } else {
                      openTab(
                        details.connection.id,
                        details.database,
                        selectTopSql(details.connection.engine, object.schema, object.name),
                        objectTabTitle(details.connection.engine, object.schema, object.name),
                      );
                    }
                  }}
                />
              ) : (
              <div className="editor-wrap">
                {tabs.map((tab) => (
                  <div key={tab.id} className={`editor-layer ${tab.id === activeTabId && !editorLocked ? "" : "hidden"}`}>
                    <Editor
                      language="sql"
                      theme="ssms"
                      value={tab.sql}
                      beforeMount={beforeMount}
                      onChange={(value) => patchTab(tab.id, { sql: value ?? "" })}
                      onMount={(editor) => {
                        editors.current.set(tab.id, editor);
                        const unbindHistory = bindEditorHistory(editor);
                        editor.onDidDispose(unbindHistory);
                        const model = editor.getModel();
                        const engine = connectionsRef.current.find((item) => item.id === tab.connectionId)?.engine;
                        if (model && engine) bindModelEngine(model, engine);
                        const relayout = () => {
                          const parent = editor.getContainerDomNode().parentElement;
                          if (parent && parent.clientWidth > 0 && parent.clientHeight > 0) {
                            editor.layout({ width: parent.clientWidth, height: parent.clientHeight });
                          }
                        };
                        relayout();
                        requestAnimationFrame(relayout);
                        const parent = editor.getContainerDomNode().parentElement;
                        const observer = parent ? new ResizeObserver(() => relayout()) : null;
                        if (parent && observer) observer.observe(parent);
                        editor.onDidDispose(() => observer?.disconnect());
                        editor.onDidChangeCursorPosition((event) => {
                          patchTab(tab.id, { line: event.position.lineNumber, column: event.position.column });
                        });
                      }}
                      options={{
                        fontFamily: "Consolas, Liberation Mono, monospace",
                        fontSize: 14,
                        fontLigatures: true,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        smoothScrolling: true,
                        cursorSmoothCaretAnimation: "on",
                        cursorBlinking: "smooth",
                        mouseWheelZoom: true,
                        wordWrap: "on",
                        automaticLayout: true,
                        tabSize: 4,
                        insertSpaces: true,
                        padding: { top: 8, bottom: 8 },
                        renderLineHighlight: "all",
                        overviewRulerLanes: 0,
                        hideCursorInOverviewRuler: true,
                        scrollbar: { verticalScrollbarSize: 12, horizontalScrollbarSize: 12 },
                        folding: true,
                        foldingHighlight: true,
                        matchBrackets: "always",
                        autoClosingBrackets: "always",
                        autoClosingQuotes: "always",
                        bracketPairColorization: { enabled: true },
                        guides: { bracketPairs: true, indentation: true },
                        stickyScroll: { enabled: true },
                        snippetSuggestions: "top",
                        tabCompletion: "on",
                        wordBasedSuggestions: "off",
                        suggestOnTriggerCharacters: true,
                        acceptSuggestionOnEnter: "on",
                        quickSuggestions: { other: true, comments: false, strings: false },
                        suggest: {
                          preview: true,
                          showSnippets: true,
                          showFunctions: true,
                          showFields: true,
                          filterGraceful: false,
                          matchOnWordStartOnly: true,
                        },
                        renderWhitespace: "selection",
                      }}
                    />
                  </div>
                ))}
              </div>
              )}
              {editorLocked ? null : <div className="splitter-h" onMouseDown={(event) => startDrag("results", event)} />}
              {editorLocked ? null : (
                <div style={{ height: resultsHeight, display: "flex", minHeight: 0 }}>
                  {activeTab ? (
                    <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
                      <ResultsPane
                        resultSets={activeTab.resultSets}
                        messages={activeTab.messages}
                        activePane={activeTab.activePane}
                        onPane={(pane) => patchTab(activeTab.id, { activePane: pane })}
                        onExport={(format) => void exportResults(format)}
                      />
                    </div>
                  ) : null}
                </div>
              )}
            </>
          )}
        </section>
        {askOpen ? (
          <>
            <div className="splitter-v" role="separator" aria-orientation="vertical" aria-label="Resize AI" onMouseDown={(event) => startDrag("ai", event)} />
            <AskDialog
              width={aiWidth}
              target={askTarget}
              onClose={() => setAskOpen(false)}
              onAsk={async (question) => {
                const connection = barConnection ?? connectionsRef.current[0];
                if (!connection) throw new Error("Connect to a database first.");
                const database = barDatabase || connection.database;
                if (!database) throw new Error("Choose a database first.");
                const columns = await listAllColumns(connection.id, database);
                const reply = await askSql(engineLabel(connection.engine), database, schemaText(columns).text, question);
                openTab(connection.id, database, sqlWithNote(reply.sql, reply.note), "Ask");
                showNotice(reply.note || "Draft SQL is in a new query. Press F5 to run it.");
              }}
            />
          </>
        ) : null}
      </div>

      <footer className="status-bar">
        <span>{activeTab?.running ? "Executing..." : notice || "Ready"}</span>
        <span>
          {barConnection
            ? `${engineLabel(barConnection.engine)} | ${barConnection.host}`
            : "No connection"}
        </span>
        <span>{barDatabase || "no database"}</span>
        <span className="right">
          <span>{activeTab?.elapsedMs != null ? `${activeTab.elapsedMs} ms` : ""}</span>
          <span>{activeTab ? `${rowCount.toLocaleString()} rows` : ""}</span>
          <span>
            Ln {activeTab?.line ?? 1}, Col {activeTab?.column ?? 1}
          </span>
        </span>
      </footer>

      {connectOpen ? (
        <ConnectDialog
          selectedId={connectSelection}
          initialError={connectError}
          onCancel={() => setConnectOpen(false)}
          onConnect={handleConnect}
        />
      ) : null}
      {rename ? (
        <RenameDialog
          title={rename.kind === "database" ? "Rename Database" : "Rename"}
          label="New name"
          current={rename.kind === "database" ? rename.database : rename.name}
          onCancel={() => setRename(null)}
          onSubmit={(name) => applyRename(rename, name)}
        />
      ) : null}
      {historyOpen ? (
        <HistoryDialog
          version={historyVersion}
          onClose={() => setHistoryOpen(false)}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenQuery={(database, sql) => openTab(activeTab?.connectionId ?? connections[0]?.id ?? null, database, sql)}
          onExport={(format, detail: HistoryDetail) => void exportSets(format, detail.resultSets, "history")}
          onClear={() => void clearSavedHistory()}
          onRollback={(detail) => rollbackSaved(detail)}
        />
      ) : null}
      {settingsOpen ? (
        <SettingsDialog
          onClose={() => setSettingsOpen(false)}
          onSaved={(message) => {
            setHistoryVersion((value) => value + 1);
            showNotice(message);
          }}
        />
      ) : null}
      {helpOpen ? <HelpDialog onClose={() => setHelpOpen(false)} /> : null}
      {aboutOpen ? (
        <div className="overlay" onMouseDown={() => setAboutOpen(false)}>
          <div className="dialog small" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-title">About DB Manager</div>
            <div className="dialog-body about">
              <img className="app-logo" src="/logo.png" alt="" width={48} height={48} />
              <p className="about-brand">MoriX</p>
              <h2>DB Manager</h2>
              <p>A desktop SQL studio for SQL Server, PostgreSQL, and MySQL.</p>
              <p className="about-company">DB Manager is a product of MoriX.</p>
            </div>
            <div className="dialog-actions">
              <button
                type="button"
                onClick={() => {
                  setAboutOpen(false);
                  setHelpOpen(true);
                }}
              >
                <KeyboardIcon />
                Shortcuts
              </button>
              <span className="spacer" />
              <button className="default" onClick={() => setAboutOpen(false)}>
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {tabMenu ? (
        <div
          className="context-menu"
          style={{ left: tabMenu.x, top: tabMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            onClick={() => {
              const id = tabMenu.id;
              setTabMenu(null);
              closeTab(id);
            }}
          >
            <span className="menu-label"><span className="menu-ico"><CloseIcon /></span><span>Close</span></span>
          </button>
          <button
            onClick={() => {
              setTabMenu(null);
              closeTabs(null);
            }}
          >
            <span className="menu-label"><span className="menu-ico"><CloseAllIcon /></span><span>Close All</span></span>
          </button>
          <button
            disabled={tabs.length + (details ? 1 : 0) + (designOpen ? 1 : 0) + tableDesigns.length < 2}
            onClick={() => {
              const id = tabMenu.id;
              setTabMenu(null);
              closeTabs(id);
            }}
          >
            <span className="menu-label"><span className="menu-ico"><CloseIcon /></span><span>Close All But This</span></span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Menu(props: {
  label: string;
  open: boolean;
  hot: boolean;
  onOpen: () => void;
  onHover: () => void;
  onDismiss: () => void;
  items: Array<{ label: string; hint?: string; disabled?: boolean; icon?: React.ReactNode; action?: () => void }>;
}) {
  return (
    <div className={`menu-item ${props.open ? "open" : ""}`} onMouseDown={(event) => event.stopPropagation()}>
      <button
        onClick={() => props.onOpen()}
        onMouseEnter={() => {
          if (props.hot) props.onHover();
        }}
      >
        {props.label}
      </button>
      {props.open ? (
        <div className="menu-pop">
          {props.items.map((item, index) =>
            item.label === "sep" ? (
              <div key={index} className="menu-sep" />
            ) : (
              <button
                key={item.label}
                disabled={item.disabled}
                onClick={() => {
                  props.onDismiss();
                  item.action?.();
                }}
              >
                <span className="menu-label">
                  <span className="menu-ico">{item.icon}</span>
                  <span>{item.label}</span>
                </span>
                <span className="hint">{item.hint}</span>
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
