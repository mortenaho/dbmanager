import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ColumnRef,
  ConnectPayload,
  Connection,
  DbObject,
  Profile,
  QueryResponse,
  ScriptResult,
  HistoryQuery,
  HistoryDetail,
  AppEvent,
  AppSettings,
} from "./types";

export function connectServer(payload: ConnectPayload): Promise<Connection> {
  return invoke<Connection>("connect", { payload });
}

export function disconnectServer(connectionId: string): Promise<void> {
  return invoke("disconnect", { connectionId });
}

export function listDatabases(connectionId: string): Promise<string[]> {
  return invoke<string[]>("list_databases", { connectionId });
}

export function listObjects(connectionId: string, database: string): Promise<DbObject[]> {
  return invoke<DbObject[]>("list_objects", { connectionId, database });
}

export function listColumns(
  connectionId: string,
  database: string,
  schema: string,
  table: string,
): Promise<ColumnInfo[]> {
  return invoke<ColumnInfo[]>("list_columns", { connectionId, database, schema, table });
}

export function listAllColumns(connectionId: string, database: string): Promise<ColumnRef[]> {
  return invoke<ColumnRef[]>("list_all_columns", { connectionId, database });
}

export function renameObject(
  connectionId: string,
  kind: "database" | "table",
  database: string,
  schema: string,
  name: string,
  newName: string,
): Promise<string> {
  return invoke<string>("rename_object", { connectionId, kind, database, schema, name, newName });
}

export function generateScript(
  connectionId: string,
  database: string,
  schema: string,
  name: string,
  kind: string,
  includeCreate: boolean,
  includeData: boolean,
): Promise<ScriptResult> {
  return invoke<ScriptResult>("generate_script", {
    connectionId,
    database,
    schema,
    name,
    kind,
    includeCreate,
    includeData,
  });
}

export function scriptRoutine(
  connectionId: string,
  database: string,
  schema: string,
  name: string,
  kind: string,
): Promise<string> {
  return invoke<string>("script_routine", { connectionId, database, schema, name, kind });
}

export function executeSql(
  connectionId: string,
  database: string,
  sql: string,
  maxRows = 5000,
): Promise<QueryResponse> {
  return invoke<QueryResponse>("execute_sql", { connectionId, database, sql, maxRows });
}

export function parseSql(
  connectionId: string,
  database: string,
  sql: string,
): Promise<QueryResponse> {
  return invoke<QueryResponse>("parse_sql", { connectionId, database, sql });
}

export function loadProfiles(): Promise<Profile[]> {
  return invoke<Profile[]>("load_profiles");
}

export function saveProfile(profile: Profile): Promise<Profile> {
  return invoke<Profile>("save_profile", { profile });
}

export function deleteProfile(id: string): Promise<void> {
  return invoke("delete_profile", { id });
}

export function listHistory(needle = ""): Promise<HistoryQuery[]> {
  return invoke<HistoryQuery[]>("list_history", { needle, limit: 200 });
}

export function getHistory(id: number): Promise<HistoryDetail> {
  return invoke<HistoryDetail>("get_history", { id });
}

export function deleteHistory(id: number): Promise<void> {
  return invoke("delete_history", { id });
}

export function clearHistory(): Promise<void> {
  return invoke("clear_history");
}

export function listEvents(needle = ""): Promise<AppEvent[]> {
  return invoke<AppEvent[]>("list_events", { needle, limit: 200 });
}

export function logEvent(level: string, kind: string, message: string): Promise<void> {
  return invoke("log_event", { level, kind, message });
}

export function loadSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("load_settings");
}

export function saveSettings(historyDays: number): Promise<AppSettings> {
  return invoke<AppSettings>("save_settings", { historyDays });
}
