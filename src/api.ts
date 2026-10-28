import { invoke } from "@tauri-apps/api/core";
import type {
  ColumnInfo,
  ColumnRef,
  ConnectPayload,
  Connection,
  DbObject,
  Profile,
  QueryResponse,
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
