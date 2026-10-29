export type EngineKind = "mssql" | "postgres" | "mysql";

export type Profile = {
  id: string;
  name: string;
  engine: EngineKind;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  trustCert: boolean;
  encrypt: boolean;
  ssl: boolean;
  rememberPassword: boolean;
};

export type ConnectPayload = {
  engine: EngineKind;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  trustCert: boolean;
  encrypt: boolean;
  ssl: boolean;
};

export type Connection = {
  id: string;
  name: string;
  engine: EngineKind;
  host: string;
  port: number;
  username: string;
  database: string;
  databases: string[];
};

export type DbObject = {
  schema: string;
  name: string;
  kind: "table" | "view" | "procedure" | "function" | string;
  created?: string;
  rowCount?: number | null;
};

export type ColumnRef = {
  schema: string;
  table: string;
  name: string;
  dataType: string;
};

export type ColumnInfo = {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
};

export type ResultSet = {
  columns: string[];
  rows: Array<Array<string | null>>;
  rowsAffected: number;
  truncated: boolean;
};

export type QueryMessage = {
  level: "info" | "warn" | "error" | string;
  text: string;
};

export type QueryResponse = {
  resultSets: ResultSet[];
  messages: QueryMessage[];
  elapsedMs: number;
};

export type ScriptResult = {
  sql: string;
  warnings: string[];
};

export type HistoryQuery = {
  id: number;
  createdAt: string;
  engine: string;
  server: string;
  databaseName: string;
  sql: string;
  status: string;
  error: string;
  elapsedMs: number;
  rowCount: number;
};

export type HistoryDetail = HistoryQuery & {
  messages: QueryMessage[];
  resultSets: ResultSet[];
};

export type AppEvent = {
  id: number;
  createdAt: string;
  level: string;
  kind: string;
  message: string;
};

export type AppSettings = {
  historyDays: number;
};

export type QueryTab = {
  id: string;
  title: string;
  sql: string;
  connectionId: string | null;
  database: string;
  resultSets: ResultSet[];
  messages: QueryMessage[];
  elapsedMs: number | null;
  running: boolean;
  activePane: "results" | "messages";
  line: number;
  column: number;
};

export function engineLabel(engine: EngineKind): string {
  if (engine === "mssql") return "SQL Server";
  if (engine === "postgres") return "PostgreSQL";
  return "MySQL";
}

export function defaultPort(engine: EngineKind): number {
  if (engine === "mssql") return 1433;
  if (engine === "postgres") return 5432;
  return 3306;
}

export function quoteIdent(engine: EngineKind, name: string): string {
  if (engine === "mssql") return `[${name.split("]").join("]]")}]`;
  if (engine === "postgres") return `"${name.split('"').join('""')}"`;
  return `\`${name.split("`").join("``")}\``;
}

export function objectTabTitle(engine: EngineKind, schema: string, name: string): string {
  const schemaName = schema.trim();
  const objectName = name.trim();
  if (engine === "mysql" || schemaName === "") return objectName;
  return `${schemaName}.${objectName}`;
}

export function selectTopSql(engine: EngineKind, schema: string, table: string): string {
  if (engine === "mssql") {
    return `SELECT TOP (1000) *\nFROM ${quoteIdent(engine, schema)}.${quoteIdent(engine, table)};`;
  }
  if (engine === "postgres") {
    return `SELECT *\nFROM ${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}\nLIMIT 1000;`;
  }
  return `SELECT *\nFROM ${quoteIdent(engine, table)}\nLIMIT 1000;`;
}

export function errorText(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}
