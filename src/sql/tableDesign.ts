import { quoteIdent, type EngineKind } from "../types";

export type ColumnDraft = {
  name: string;
  originalName: string;
  dataType: string;
  length: number;
  precision: number;
  scale: number;
  nullable: boolean;
  primaryKey: boolean;
  identity: boolean;
  seed: number;
  increment: number;
  defaultValue: string;
};

const SIZED = new Set(["varchar", "nvarchar", "char", "nchar"]);
const DECIMAL = new Set(["decimal", "numeric"]);
const INTEGER = new Set(["int", "integer", "bigint", "smallint", "tinyint"]);

export function engineTypes(engine: EngineKind): string[] {
  if (engine === "mssql") {
    return ["int", "bigint", "smallint", "tinyint", "bit", "decimal", "numeric", "float", "real", "money", "date", "datetime", "datetime2", "time", "char", "nchar", "varchar", "nvarchar", "uniqueidentifier"];
  }
  if (engine === "postgres") {
    return ["integer", "bigint", "smallint", "boolean", "numeric", "real", "double precision", "date", "timestamp", "text", "char", "varchar", "uuid"];
  }
  return ["int", "bigint", "smallint", "tinyint", "decimal", "double", "date", "datetime", "timestamp", "char", "varchar", "text"];
}

export function sizedType(dataType: string): boolean {
  return SIZED.has(dataType.toLowerCase());
}

export function decimalType(dataType: string): boolean {
  return DECIMAL.has(dataType.toLowerCase());
}

export function integerType(dataType: string): boolean {
  return INTEGER.has(dataType.toLowerCase());
}

export function formatColumnType(column: Pick<ColumnDraft, "dataType" | "length" | "precision" | "scale">): string {
  const type = column.dataType.toLowerCase();
  if (SIZED.has(type)) {
    if (!column.length) return `${type}(max)`;
    return `${type}(${column.length})`;
  }
  if (DECIMAL.has(type)) return `${type}(${column.precision || 18}, ${column.scale || 0})`;
  return type;
}

export function parseColumnType(value: string): { dataType: string; length: number; precision: number; scale: number } {
  const trimmed = value.trim().toLowerCase();
  const decimal = /^(decimal|numeric)\s*\(\s*(\d+)\s*,\s*(\d+)\s*\)/.exec(trimmed);
  if (decimal) return { dataType: decimal[1], length: 0, precision: Number(decimal[2]), scale: Number(decimal[3]) };
  if (trimmed.startsWith("character varying")) {
    const length = /\((\d+)\)/.exec(trimmed);
    return { dataType: "varchar", length: length ? Number(length[1]) : 0, precision: 18, scale: 0 };
  }
  if (trimmed === "int4") return { dataType: "integer", length: 0, precision: 18, scale: 0 };
  if (trimmed === "int8") return { dataType: "bigint", length: 0, precision: 18, scale: 0 };
  const sized = /^([a-z0-9 ]+?)\((\d+|max)\)/.exec(trimmed);
  if (sized) {
    return { dataType: sized[1].trim(), length: sized[2] === "max" ? 0 : Number(sized[2]), precision: 18, scale: 0 };
  }
  return { dataType: trimmed.split("(")[0].trim(), length: 0, precision: 18, scale: 0 };
}

export function primaryKeyLookupSql(engine: EngineKind, schema: string, table: string): string {
  const literal = (value: string) => `'${value.split("'").join("''")}'`;
  if (engine === "mssql") {
    return `SELECT kc.name AS name FROM sys.key_constraints AS kc WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID(N${literal(`${schema}.${table}`)})`;
  }
  if (engine === "postgres") {
    return `SELECT con.conname AS name FROM pg_constraint AS con JOIN pg_class AS rel ON rel.oid = con.conrelid JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace WHERE con.contype = 'p' AND rel.relname = ${literal(table)} AND nsp.nspname = ${literal(schema)}`;
  }
  return `SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = ${literal(table)} AND constraint_type = 'PRIMARY KEY'`;
}

export function createTableSql(engine: EngineKind, schema: string, name: string, columns: ColumnDraft[]): string {
  const ready = usable(columns);
  const lines = ready.map((column) => `    ${columnSql(engine, column)}`);
  const keys = ready.filter((column) => column.primaryKey).map((column) => quoteIdent(engine, column.name));
  if (keys.length) lines.push(`    PRIMARY KEY (${keys.join(", ")})`);
  let sql = `CREATE TABLE ${qualify(engine, schema, name)} (\n${lines.join(",\n")}\n)`;
  const identity = ready.find((column) => column.identity);
  if (engine === "mysql" && identity && identity.seed > 1) sql += ` AUTO_INCREMENT=${identity.seed}`;
  return sql;
}

export function alterTableSql(
  engine: EngineKind,
  schema: string,
  name: string,
  previous: ColumnDraft[],
  next: ColumnDraft[],
  primaryKey: string,
): { statements: string[]; error: string } {
  const ready = usable(next);
  const seen = new Set<string>();
  for (const column of ready) {
    const key = column.name.toLowerCase();
    if (seen.has(key)) return { statements: [], error: `Column ${column.name} is listed more than once.` };
    seen.add(key);
    if (column.originalName && column.identity !== previousIdentity(previous, column.originalName)) {
      return { statements: [], error: "Identity can only be set when the column is created." };
    }
  }
  if (!ready.length) return { statements: [], error: "Add at least one column." };
  const table = qualify(engine, schema, name);
  const statements: string[] = [];
  const oldKeys = previous.filter((column) => column.primaryKey).map((column) => column.name.toLowerCase());
  const newKeys = ready.filter((column) => column.primaryKey).map((column) => column.name.toLowerCase());
  const keysChanged = oldKeys.join("\0") !== newKeys.join("\0");
  if (keysChanged && primaryKey) {
    statements.push(`ALTER TABLE ${table} DROP CONSTRAINT ${quoteIdent(engine, primaryKey)}`);
  }
  for (const old of previous) {
    const kept = ready.some((column) => column.originalName.toLowerCase() === old.name.toLowerCase());
    if (!kept) statements.push(`ALTER TABLE ${table} DROP COLUMN ${quoteIdent(engine, old.name)}`);
  }
  for (const column of ready) {
    if (!column.originalName) {
      statements.push(`ALTER TABLE ${table} ADD ${columnSql(engine, column)}`);
      continue;
    }
    const old = previous.find((item) => item.name.toLowerCase() === column.originalName.toLowerCase());
    if (!old) continue;
    if (old.name.toLowerCase() !== column.name.toLowerCase()) {
      statements.push(renameColumn(engine, schema, name, old.name, column.name));
    }
    if (definitionChanged(old, column)) statements.push(alterColumn(engine, schema, name, column));
    if (engine !== "mysql" && (old.defaultValue || "") !== (column.defaultValue || "") && column.defaultValue.trim()) {
      statements.push(setDefault(engine, schema, name, column));
    }
    if (engine === "mysql" && !definitionChanged(old, column) && (old.defaultValue || "") !== (column.defaultValue || "") && column.defaultValue.trim()) {
      statements.push(setDefault(engine, schema, name, column));
    }
  }
  if (keysChanged && newKeys.length) {
    const keys = ready.filter((column) => column.primaryKey).map((column) => quoteIdent(engine, column.name));
    statements.push(`ALTER TABLE ${table} ADD PRIMARY KEY (${keys.join(", ")})`);
  }
  return { statements, error: "" };
}

function previousIdentity(previous: ColumnDraft[], originalName: string): boolean {
  return previous.some((column) => column.name.toLowerCase() === originalName.toLowerCase() && column.identity);
}

function usable(columns: ColumnDraft[]): ColumnDraft[] {
  return columns.filter((column) => column.name.trim() !== "");
}

function definitionChanged(old: ColumnDraft, next: ColumnDraft): boolean {
  return (
    old.dataType.toLowerCase() !== next.dataType.toLowerCase() ||
    old.length !== next.length ||
    old.precision !== next.precision ||
    old.scale !== next.scale ||
    old.nullable !== next.nullable
  );
}

function columnSql(engine: EngineKind, column: ColumnDraft): string {
  const parts = [quoteIdent(engine, column.name), typeSql(engine, column)];
  if (column.identity && engine === "mssql") parts.push(`IDENTITY(${column.seed || 1}, ${column.increment || 1})`);
  if (column.identity && engine === "postgres") {
    parts.push(`GENERATED BY DEFAULT AS IDENTITY (START WITH ${column.seed || 1} INCREMENT BY ${column.increment || 1})`);
  }
  parts.push(column.nullable && !column.primaryKey && !column.identity ? "NULL" : "NOT NULL");
  if (column.identity && engine === "mysql") parts.push("AUTO_INCREMENT");
  if (column.defaultValue.trim()) parts.push(`DEFAULT ${column.defaultValue.trim()}`);
  return parts.join(" ");
}

function typeSql(engine: EngineKind, column: ColumnDraft): string {
  const type = column.dataType.toLowerCase();
  if (SIZED.has(type)) {
    if (!column.length) {
      if (engine === "mssql") return `${type}(max)`;
      if (type === "varchar" || type === "nvarchar") return engine === "mysql" ? "text" : "text";
      return `${type}(1)`;
    }
    if (engine === "postgres" && (type === "nvarchar" || type === "nchar")) return `varchar(${column.length})`;
    if (engine === "mysql" && (type === "nvarchar" || type === "nchar")) return `varchar(${column.length})`;
    return `${type}(${column.length})`;
  }
  if (DECIMAL.has(type)) return `${type}(${column.precision || 18}, ${column.scale || 0})`;
  if (engine === "postgres" && type === "int") return "integer";
  if (engine === "mysql" && type === "integer") return "int";
  return type;
}

function alterColumn(engine: EngineKind, schema: string, table: string, column: ColumnDraft): string {
  const target = qualify(engine, schema, table);
  const typed = typeSql(engine, column);
  const quoted = quoteIdent(engine, column.name);
  if (engine === "mssql") {
    const nullSql = column.nullable && !column.primaryKey ? "NULL" : "NOT NULL";
    return `ALTER TABLE ${target} ALTER COLUMN ${quoted} ${typed} ${nullSql}`;
  }
  if (engine === "postgres") {
    const nullSql = column.nullable && !column.primaryKey ? `ALTER COLUMN ${quoted} DROP NOT NULL` : `ALTER COLUMN ${quoted} SET NOT NULL`;
    return `ALTER TABLE ${target} ALTER COLUMN ${quoted} TYPE ${typed}, ${nullSql}`;
  }
  return `ALTER TABLE ${target} MODIFY ${columnSql(engine, column)}`;
}

function setDefault(engine: EngineKind, schema: string, table: string, column: ColumnDraft): string {
  const target = qualify(engine, schema, table);
  const quoted = quoteIdent(engine, column.name);
  const value = column.defaultValue.trim();
  if (engine === "mssql") return `ALTER TABLE ${target} ADD DEFAULT ${value} FOR ${quoted}`;
  if (engine === "postgres") return `ALTER TABLE ${target} ALTER COLUMN ${quoted} SET DEFAULT ${value}`;
  return `ALTER TABLE ${target} ALTER ${quoted} SET DEFAULT ${value}`;
}

function renameColumn(engine: EngineKind, schema: string, table: string, from: string, to: string): string {
  if (engine === "mssql") {
    const literal = (value: string) => value.split("'").join("''");
    return `EXEC sp_rename N'${literal(schema)}.${literal(table)}.${literal(from)}', N'${literal(to)}', N'COLUMN'`;
  }
  return `ALTER TABLE ${qualify(engine, schema, table)} RENAME COLUMN ${quoteIdent(engine, from)} TO ${quoteIdent(engine, to)}`;
}

function qualify(engine: EngineKind, schema: string, name: string): string {
  if (engine === "mysql" || schema.trim() === "") return quoteIdent(engine, name);
  return `${quoteIdent(engine, schema)}.${quoteIdent(engine, name)}`;
}
