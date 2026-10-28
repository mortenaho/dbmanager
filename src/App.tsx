import { getCurrentWindow } from "@tauri-apps/api/window";
import Editor, { type BeforeMount, type OnMount } from "@monaco-editor/react";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  connectServer,
  disconnectServer,
  executeSql,
  listAllColumns,
  listDatabases,
  listObjects,
  loadProfiles,
  parseSql,
  generateScript,
  renameObject,
  saveProfile,
  scriptRoutine,
} from "./api";
import { ConnectDialog } from "./components/ConnectDialog";
import { CheckIcon, FormatIcon, NewQueryIcon, PlayIcon, PlugIcon } from "./components/Icons";
import { ObjectExplorer } from "./components/ObjectExplorer";
import { RenameDialog } from "./components/RenameDialog";
import { ResultsPane } from "./components/ResultsPane";
import {
  bindModelEngine,
  emptyCatalog,
  formatSql,
  insertSnippet,
  registerSqlEditor,
  setSqlCatalog,
  SQL_SNIPPETS,
} from "./sql/editor";
import {
  engineLabel,
  errorText,
  type Connection,
  type ConnectPayload,
  type DbObject,
  type Profile,
  type QueryTab,
} from "./types";

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
  const [menu, setMenu] = useState<string | null>(null);
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
  const editors = useRef(new Map<string, Parameters<OnMount>[0]>());
  tabsRef.current = tabs;
  activeRef.current = activeTabId;
  connectionsRef.current = connections;
  contextRef.current = context;

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeConnection = connections.find((item) => item.id === activeTab?.connectionId) ?? null;

  useEffect(() => {
    editors.current.get(activeTabId ?? "")?.layout();
  }, [activeTabId, resultsHeight, explorerWidth, showExplorer]);

  useEffect(() => {
    loadProfiles()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, []);

  useEffect(() => {
    const tab = tabs.find((item) => item.id === activeTabId);
    const connection = connections.find((item) => item.id === tab?.connectionId);
    const title = tab ? `${tab.title}${connection ? ` - ${connection.host}` : ""} - DB Manager` : "DB Manager";
    try {
      void getCurrentWindow().setTitle(title).catch(() => undefined);
    } catch {
      // The page can be previewed in a browser, where the Tauri window API is absent.
    }
  }, [tabs, activeTabId, connections]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (connectOpen || aboutOpen || rename) return;
      if (event.key === "F5" && event.ctrlKey) {
        event.preventDefault();
        void parseRef.current();
      } else if (event.key === "F5") {
        event.preventDefault();
        void runRef.current();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        newQueryRef.current();
      } else if (event.shiftKey && event.altKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        formatRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [connectOpen, aboutOpen, rename]);

  function makeTab(connectionId: string | null, database: string, sql = ""): QueryTab {
    counter.current += 1;
    return {
      id: crypto.randomUUID(),
      title: `SQLQuery${counter.current}.sql`,
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

  function openTab(connectionId: string | null, database: string, sql = "") {
    const tab = makeTab(connectionId, database, sql);
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
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
    editors.current.delete(id);
    setTabs((current) => {
      const next = current.filter((tab) => tab.id !== id);
      setActiveTabId((active) => {
        if (active !== id) return active;
        return next.length > 0 ? next[next.length - 1].id : null;
      });
      return next;
    });
  }

  function patchTab(id: string, patch: Partial<QueryTab>) {
    setTabs((current) => current.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)));
  }

  async function runQuery() {
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab || tab.running) return;
    if (!tab.connectionId) {
      openConnect();
      return;
    }
    patchTab(tab.id, { running: true, messages: [], resultSets: [], activePane: "results" });
    const started = performance.now();
    try {
      const response = await executeSql(tab.connectionId, tab.database, tab.sql);
      const failed = response.messages.some((message) => message.level === "error");
      patchTab(tab.id, {
        running: false,
        resultSets: response.resultSets,
        messages: response.messages,
        elapsedMs: response.elapsedMs,
        activePane: failed ? "messages" : "results",
      });
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
    const tab = tabsRef.current.find((item) => item.id === activeRef.current);
    if (!tab || tab.running) return;
    if (!tab.connectionId) {
      openConnect();
      return;
    }
    patchTab(tab.id, { running: true });
    try {
      const response = await parseSql(tab.connectionId, tab.database, tab.sql);
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

  async function openRoutine(connectionId: string, database: string, object: DbObject) {
    try {
      const sql = await scriptRoutine(connectionId, database, object.schema, object.name, object.kind);
      openTab(connectionId, database, sql.endsWith("\n") ? sql : `${sql}\n`);
    } catch (reason) {
      openTab(connectionId, database, `-- ${errorText(reason)}\n`);
    }
  }

  const scriptingRef = useRef(false);

  async function saveSqlFile(fileName: string, contents: string): Promise<"saved" | "cancelled"> {
    const tauri = "__TAURI_INTERNALS__" in window || "__TAURI__" in window;
    if (!tauri) {
      const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      URL.revokeObjectURL(url);
      return "saved";
    }
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { invoke } = await import("@tauri-apps/api/core");
    const path = await save({
      defaultPath: fileName,
      filters: [{ name: "SQL script", extensions: ["sql"] }],
    });
    if (!path) return "cancelled";
    await invoke("write_text_file", { path, contents });
    return "saved";
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
        openTab(connectionId, database, sql.endsWith("\n") ? sql : `${sql}\n`);
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

  function startDrag(kind: "explorer" | "results", event: ReactMouseEvent) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = explorerWidth;
    const startHeight = resultsHeight;
    const move = (ev: MouseEvent) => {
      if (kind === "explorer") {
        setExplorerWidth(Math.min(560, Math.max(200, startWidth + ev.clientX - startX)));
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
    const engine = connections.find((item) => item.id === connectionId)?.engine;
    if (!connectionId || !database || !engine) {
      setSqlCatalog(emptyCatalog(engine ?? "postgres"));
      return;
    }
    let cancel = false;
    Promise.all([listObjects(connectionId, database), listAllColumns(connectionId, database)])
      .then(([objects, columns]) => {
        if (cancel) return;
        setSqlCatalog({
          engine,
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

  return (
    <div className="ssms" onMouseDown={() => setMenu(null)}>
      <div className="menu-bar">
        <Menu
          label="File"
          open={menu === "File"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "File" ? null : "File")}
          onHover={() => setMenu("File")}
          onDismiss={() => setMenu(null)}
          items={[
            { label: "New Query", hint: "Ctrl+N", action: () => newQuery() },
            { label: "Connect...", hint: "", action: () => openConnect() },
            ...recent.slice(0, 5).map((profile) => ({
              label: `Connect to ${profile.name}`,
              hint: engineLabel(profile.engine),
              disabled: connectingId !== null,
              action: () => void quickConnect(profile),
            })),
            {
              label: "Generate Scripts",
              hint: "",
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
              disabled: !activeConnection,
              action: () => activeConnection && void disconnect(activeConnection.id),
            },
            { label: "sep" },
            {
              label: "Exit",
              hint: "",
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
              action: () => setShowExplorer((value) => !value),
            },
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
            { label: "Execute", hint: "F5", disabled: !activeTab || activeTab.running, action: () => void runQuery() },
            {
              label: "Parse",
              hint: "Ctrl+F5",
              disabled: !activeTab || activeTab.running,
              action: () => void parseQuery(),
            },
            {
              label: "Format SQL",
              hint: "Shift+Alt+F",
              disabled: !activeTab,
              action: () => formatQuery(),
            },
            { label: "sep" },
            ...SQL_SNIPPETS.filter((snippet) =>
              ["select", "ins", "upd", "join", "createproc"].includes(snippet.label),
            ).map((snippet) => ({
              label: `Insert ${snippet.detail}`,
              hint: "",
              disabled: !activeTab,
              action: () => insertQuerySnippet(snippet.insertText),
            })),
          ]}
        />
        <Menu
          label="Help"
          open={menu === "Help"}
          hot={menu !== null}
          onOpen={() => setMenu(menu === "Help" ? null : "Help")}
          onHover={() => setMenu("Help")}
          onDismiss={() => setMenu(null)}
          items={[{ label: "About DB Manager", hint: "", action: () => setAboutOpen(true) }]}
        />
      </div>

      <div className="toolbar">
        <button className="tool" title="Connect" onClick={() => openConnect()}>
          <PlugIcon />
        </button>
        <button className="tool" title="New Query (Ctrl+N)" onClick={() => newQuery()}>
          <NewQueryIcon />
        </button>
        <span className="tool-sep" />
        <button className="tool primary" title="Execute (F5)" disabled={!activeTab || activeTab.running} onClick={() => void runQuery()}>
          <PlayIcon />
          <span>Execute</span>
        </button>
        <button className="tool" title="Parse (Ctrl+F5)" disabled={!activeTab || activeTab.running} onClick={() => void parseQuery()}>
          <CheckIcon />
        </button>
        <button className="tool" title="Format SQL (Shift+Alt+F)" disabled={!activeTab} onClick={() => formatQuery()}>
          <FormatIcon />
        </button>
        <span className="tool-sep" />
        <select
          className="conn-select"
          value={activeTab?.connectionId ?? ""}
          disabled={!activeTab}
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
          value={activeTab?.database ?? ""}
          disabled={!activeConnection}
          onChange={(event) => activeTab && patchTab(activeTab.id, { database: event.target.value })}
        >
          {(activeConnection?.databases ?? []).map((database) => (
            <option key={database} value={database}>
              {database}
            </option>
          ))}
          {activeTab && activeTab.database && !activeConnection?.databases.includes(activeTab.database) ? (
            <option value={activeTab.database}>{activeTab.database}</option>
          ) : null}
        </select>
        <span className="spacer" />
        <span className="server-chip">
          {activeConnection
            ? `${activeConnection.username}@${activeConnection.host},${activeConnection.port}`
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
              onSelectTop={(connectionId, database, sql) => openTab(connectionId, database, sql)}
              onSelectContext={(connectionId, database) => setContext({ connectionId, database })}
              onRenameDatabase={(connectionId, database) =>
                setRename({ kind: "database", connectionId, database })
              }
              onRenameTable={(connectionId, database, schema, name) =>
                setRename({ kind: "table", connectionId, database, schema, name })
              }
              onScriptRoutine={(connectionId, database, object) => void openRoutine(connectionId, database, object)}
              onGenerateScript={(connectionId, database, object, mode) =>
                void runGenerate(connectionId, database, object, mode)
              }
            />
            <div className="splitter-v" onMouseDown={(event) => startDrag("explorer", event)} />
          </>
        ) : null}
        <section className="document">
          {tabs.length === 0 ? (
            <div className="blank">
              <div className="blank-card">
                <img className="app-logo" src="/logo.png" alt="" width={72} height={72} />
                <h1>DB Manager</h1>
                <p>Connect to SQL Server, PostgreSQL, or MySQL, then write a query and press F5.</p>
                <div className="blank-actions">
                  {recent[0] ? (
                    <button className="big" disabled={connectingId !== null} onClick={() => void quickConnect(recent[0])}>
                      {connectingId === recent[0].id ? "Connecting..." : `Connect to ${recent[0].name}`}
                    </button>
                  ) : (
                    <button className="big" onClick={() => openConnect(null)}>
                      Connect
                    </button>
                  )}
                  {recent.slice(1, 5).map((profile) => (
                    <button key={profile.id} type="button" disabled={connectingId !== null} onClick={() => void quickConnect(profile)}>
                      <span>{profile.name}</span>
                      <span className="meta">{engineLabel(profile.engine)}</span>
                    </button>
                  ))}
                  {recent.length > 0 ? (
                    <button className="quiet" type="button" onClick={() => openConnect(null)}>
                      New connection
                    </button>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="doc-tabs">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className={`doc-tab ${tab.id === activeTabId ? "active" : ""}`}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                      setActiveTabId(tab.id);
                    }}
                  >
                    <span>{tab.title}</span>
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
              <div className="editor-wrap">
                {tabs.map((tab) => (
                  <div key={tab.id} className={`editor-layer ${tab.id === activeTabId ? "" : "hidden"}`}>
                    <Editor
                      language="sql"
                      theme="ssms"
                      value={tab.sql}
                      beforeMount={beforeMount}
                      onChange={(value) => patchTab(tab.id, { sql: value ?? "" })}
                      onMount={(editor) => {
                        editors.current.set(tab.id, editor);
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
                        suggest: { preview: true, showSnippets: true, showFunctions: true, showFields: true },
                        renderWhitespace: "selection",
                      }}
                    />
                  </div>
                ))}
              </div>
              <div className="splitter-h" onMouseDown={(event) => startDrag("results", event)} />
              <div style={{ height: resultsHeight, display: "flex", minHeight: 0 }}>
                {activeTab ? (
                  <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
                    <ResultsPane
                      resultSets={activeTab.resultSets}
                      messages={activeTab.messages}
                      activePane={activeTab.activePane}
                      onPane={(pane) => patchTab(activeTab.id, { activePane: pane })}
                    />
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>
      </div>

      <footer className="status-bar">
        <span>{activeTab?.running ? "Executing..." : notice || "Ready"}</span>
        <span>
          {activeConnection
            ? `${engineLabel(activeConnection.engine)} | ${activeConnection.host}`
            : "No connection"}
        </span>
        <span>{activeTab?.database || "no database"}</span>
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
      {aboutOpen ? (
        <div className="overlay" onMouseDown={() => setAboutOpen(false)}>
          <div className="dialog small" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dialog-title">About DB Manager</div>
            <div className="dialog-body about">
              <img className="app-logo" src="/logo.png" alt="" width={48} height={48} />
              <p>
                <strong>DB Manager</strong> is a desktop SQL studio for SQL Server, PostgreSQL, and MySQL.
              </p>
              <p>Press F5 to execute the current query. Ctrl+F5 checks the syntax. Shift+Alt+F formats it. Ctrl+N opens a new query window.</p>
              <p>
                Object Explorer lists databases, tables, views, stored procedures, functions, and columns. Right-click a
                database or table to rename it, generate a script, or save a SQL backup. Double-click a procedure to script it.
              </p>
              <p>In the editor, type a snippet such as sel, ins, or join, or type a table name and press Ctrl+Space.</p>
            </div>
            <div className="dialog-actions">
              <button className="default" onClick={() => setAboutOpen(false)}>
                OK
              </button>
            </div>
          </div>
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
  items: Array<{ label: string; hint?: string; disabled?: boolean; action?: () => void }>;
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
                <span>{item.label}</span>
                <span className="hint">{item.hint}</span>
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
