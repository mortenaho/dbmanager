import { quoteIdent, type EngineKind } from "../types";

export type SchemaInfo = { name: string; owner: string };

export function schemaCatalogSql(engine: EngineKind): string {
  if (engine === "mssql") return "SELECT s.name, COALESCE(USER_NAME(s.principal_id), '') FROM sys.schemas s ORDER BY s.name";
  if (engine === "postgres") return "SELECT n.nspname, pg_get_userbyid(n.nspowner) FROM pg_namespace n WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' ORDER BY n.nspname";
  throw new Error("MySQL schemas are managed as databases.");
}

export function schemaStatement(engine: EngineKind, mode: "create" | "rename" | "owner" | "delete", name: string, value = ""): string {
  if (engine === "mysql") throw new Error("MySQL schemas are managed as databases.");
  if (!name.trim() || (mode === "rename" || mode === "owner") && !value.trim()) throw new Error("Name is required.");
  const target = quoteIdent(engine, name.trim());
  if (mode === "create") return `CREATE SCHEMA ${target}`;
  if (mode === "delete") return `DROP SCHEMA ${target}${engine === "postgres" ? " RESTRICT" : ""}`;
  if (mode === "rename") {
    if (engine !== "postgres") throw new Error("SQL Server does not support renaming a schema directly.");
    return `ALTER SCHEMA ${target} RENAME TO ${quoteIdent(engine, value.trim())}`;
  }
  return engine === "mssql"
    ? `ALTER AUTHORIZATION ON SCHEMA::${target} TO ${quoteIdent(engine, value.trim())}`
    : `ALTER SCHEMA ${target} OWNER TO ${quoteIdent(engine, value.trim())}`;
}
