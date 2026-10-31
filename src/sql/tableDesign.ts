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
  comment: string;
};

export type IndexDraft = {
  name: string;
  originalName: string;
  unique: boolean;
  kind: string;
  columns: string[];
};

export type RelationDraft = {
  name: string;
  originalName: string;
  columns: string[];
  refSchema: string;
  refTable: string;
  refColumns: string[];
  onDelete: string;
  onUpdate: string;
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

export function primaryKeyLookupSql(engine: EngineKind, database: string, schema: string, table: string): string {
  const literal = (value: string) => `'${value.split("'").join("''")}'`;
  if (engine === "mssql") {
    return `SELECT kc.name AS name FROM ${mssqlSys(database)}.key_constraints AS kc WHERE kc.type = 'PK' AND kc.parent_object_id = OBJECT_ID(${mssqlObjectId(database, schema, table)})`;
  }
  if (engine === "postgres") {
    return `SELECT con.conname AS name FROM pg_constraint AS con JOIN pg_class AS rel ON rel.oid = con.conrelid JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace WHERE con.contype = 'p' AND rel.relname = ${literal(table)} AND nsp.nspname = ${literal(schema)}`;
  }
  return `SELECT constraint_name AS name FROM information_schema.table_constraints WHERE table_schema = ${mysqlSchemaExpr(database)} AND table_name = ${literal(table)} AND constraint_type = 'PRIMARY KEY'`;
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
    const shapeChanged = definitionChanged(old, column);
    const commentChanged = (old.comment || "").trim() !== (column.comment || "").trim();
    if (shapeChanged || (engine === "mysql" && commentChanged)) statements.push(alterColumn(engine, schema, name, column));
    if (engine !== "mysql" && (old.defaultValue || "") !== (column.defaultValue || "") && column.defaultValue.trim()) {
      statements.push(setDefault(engine, schema, name, column));
    }
    if (engine === "mysql" && !shapeChanged && !commentChanged && (old.defaultValue || "") !== (column.defaultValue || "") && column.defaultValue.trim()) {
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
  if (engine === "mysql" && (column.comment.trim() || column.originalName)) parts.push(`COMMENT ${sqlLiteral(engine, column.comment)}`);
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

export function indexKinds(engine: EngineKind): string[] {
  if (engine === "mssql") return ["NONCLUSTERED", "CLUSTERED"];
  if (engine === "postgres") return ["btree", "hash", "gin", "gist", "brin", "spgist"];
  return ["BTREE", "HASH", "FULLTEXT", "SPATIAL"];
}

export function defaultIndexKind(engine: EngineKind): string {
  return indexKinds(engine)[0];
}

export function relationActions(engine: EngineKind): string[] {
  const actions = ["NO ACTION", "CASCADE", "SET NULL", "RESTRICT"];
  if (engine === "mysql") return actions;
  return [...actions, "SET DEFAULT"];
}

export function uniqueIndexAllowed(engine: EngineKind, kind: string): boolean {
  const value = kind.toLowerCase();
  if (engine === "postgres") return value === "btree";
  if (engine === "mysql") return value === "btree";
  return value === "clustered" || value === "nonclustered";
}

export function columnCommentSql(engine: EngineKind, database: string, schema: string, table: string): string {
  const tableName = embed(table);
  const schemaName = embed(schema);
  if (engine === "mssql") {
    const sys = mssqlSys(database);
    return `SELECT c.name, CAST(ep.value AS nvarchar(4000)) FROM ${sys}.columns AS c LEFT JOIN ${sys}.extended_properties AS ep ON ep.major_id = c.object_id AND ep.minor_id = c.column_id AND ep.name = N'MS_Description' WHERE c.object_id = OBJECT_ID(${mssqlObjectId(database, schema, table)})`;
  }
  if (engine === "postgres") {
    return `SELECT a.attname, col_description(a.attrelid, a.attnum) FROM pg_attribute AS a JOIN pg_class AS rel ON rel.oid = a.attrelid JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace WHERE nsp.nspname = '${schemaName}' AND rel.relname = '${tableName}' AND a.attnum > 0 AND NOT a.attisdropped`;
  }
  return `SELECT COLUMN_NAME, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ${mysqlSchemaExpr(database)} AND TABLE_NAME = '${tableName}' ORDER BY ORDINAL_POSITION`;
}

export function indexCatalogSql(engine: EngineKind, database: string, schema: string, table: string): string {
  const tableName = embed(table);
  const schemaName = embed(schema);
  if (engine === "mssql") {
    const sys = mssqlSys(database);
    return `SELECT i.name, CAST(i.is_unique AS int), i.type_desc, col.name FROM ${sys}.indexes AS i INNER JOIN ${sys}.index_columns AS ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0 INNER JOIN ${sys}.columns AS col ON col.object_id = ic.object_id AND col.column_id = ic.column_id WHERE i.object_id = OBJECT_ID(${mssqlObjectId(database, schema, table)}) AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 AND i.type IN (1, 2) ORDER BY i.name, ic.key_ordinal`;
  }
  if (engine === "postgres") {
    return `SELECT ic.relname, ix.indisunique, am.amname, a.attname FROM pg_index AS ix JOIN pg_class AS t ON t.oid = ix.indrelid JOIN pg_namespace AS n ON n.oid = t.relnamespace JOIN pg_class AS ic ON ic.oid = ix.indexrelid JOIN pg_am AS am ON am.oid = ic.relam JOIN LATERAL unnest(ix.indkey::smallint[]) WITH ORDINALITY AS k(attnum, ord) ON k.attnum > 0 JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = k.attnum WHERE n.nspname = '${schemaName}' AND t.relname = '${tableName}' AND NOT ix.indisprimary AND NOT EXISTS (SELECT 1 FROM pg_constraint AS con WHERE con.conindid = ix.indexrelid) ORDER BY ic.relname, k.ord`;
  }
  return `SELECT INDEX_NAME, CASE WHEN NON_UNIQUE = 0 THEN 1 ELSE 0 END, INDEX_TYPE, COLUMN_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ${mysqlSchemaExpr(database)} AND TABLE_NAME = '${tableName}' AND INDEX_NAME <> 'PRIMARY' ORDER BY INDEX_NAME, SEQ_IN_INDEX`;
}

export function relationCatalogSql(engine: EngineKind, database: string, schema: string, table: string): string {
  const tableName = embed(table);
  const schemaName = embed(schema);
  if (engine === "mssql") {
    const sys = mssqlSys(database);
    return `SELECT fk.name, pc.name, rs.name, rt.name, rc.name, REPLACE(fk.delete_referential_action_desc, '_', ' '), REPLACE(fk.update_referential_action_desc, '_', ' ') FROM ${sys}.foreign_keys AS fk INNER JOIN ${sys}.foreign_key_columns AS fkc ON fkc.constraint_object_id = fk.object_id INNER JOIN ${sys}.columns AS pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id INNER JOIN ${sys}.columns AS rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id INNER JOIN ${sys}.tables AS rt ON rt.object_id = fk.referenced_object_id INNER JOIN ${sys}.schemas AS rs ON rs.schema_id = rt.schema_id WHERE fk.parent_object_id = OBJECT_ID(${mssqlObjectId(database, schema, table)}) ORDER BY fk.name, fkc.constraint_column_id`;
  }
  if (engine === "postgres") {
    return `SELECT con.conname, src.attname, tn.nspname, tt.relname, dst.attname, con.confdeltype, con.confupdtype FROM pg_constraint AS con JOIN pg_class AS rel ON rel.oid = con.conrelid JOIN pg_namespace AS nsp ON nsp.oid = rel.relnamespace JOIN LATERAL generate_subscripts(con.conkey, 1) AS ord(i) ON true JOIN pg_attribute AS src ON src.attrelid = rel.oid AND src.attnum = con.conkey[ord.i] JOIN pg_class AS tt ON tt.oid = con.confrelid JOIN pg_namespace AS tn ON tn.oid = tt.relnamespace JOIN pg_attribute AS dst ON dst.attrelid = tt.oid AND dst.attnum = con.confkey[ord.i] WHERE con.contype = 'f' AND nsp.nspname = '${schemaName}' AND rel.relname = '${tableName}' ORDER BY con.conname, ord.i`;
  }
  return `SELECT k.CONSTRAINT_NAME, k.COLUMN_NAME, IFNULL(k.REFERENCED_TABLE_SCHEMA, ''), k.REFERENCED_TABLE_NAME, k.REFERENCED_COLUMN_NAME, r.DELETE_RULE, r.UPDATE_RULE FROM information_schema.KEY_COLUMN_USAGE AS k INNER JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME WHERE k.TABLE_SCHEMA = ${mysqlSchemaExpr(database)} AND k.TABLE_NAME = '${tableName}' AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`;
}

export function parseComments(rows: Array<Array<string | null>>): Map<string, string> {
  const comments = new Map<string, string>();
  for (const row of rows) {
    const name = (row[0] ?? "").trim();
    if (!name) continue;
    comments.set(name.toLowerCase(), row[1] ?? "");
  }
  return comments;
}

export function parseIndexes(rows: Array<Array<string | null>>): IndexDraft[] {
  const groups = new Map<string, IndexDraft>();
  const ordered: IndexDraft[] = [];
  for (const row of rows) {
    const name = (row[0] ?? "").trim();
    const column = (row[3] ?? "").trim();
    if (!name) continue;
    let item = groups.get(name.toLowerCase());
    if (!item) {
      item = { name, originalName: name, unique: truthy(row[1]), kind: (row[2] ?? "").trim(), columns: [] };
      groups.set(name.toLowerCase(), item);
      ordered.push(item);
    }
    if (column) item.columns.push(column);
  }
  return ordered;
}

export function parseRelations(engine: EngineKind, rows: Array<Array<string | null>>): RelationDraft[] {
  const groups = new Map<string, RelationDraft>();
  const ordered: RelationDraft[] = [];
  for (const row of rows) {
    const name = (row[0] ?? "").trim();
    const column = (row[1] ?? "").trim();
    const refColumn = (row[4] ?? "").trim();
    if (!name) continue;
    let item = groups.get(name.toLowerCase());
    if (!item) {
      item = {
        name,
        originalName: name,
        columns: [],
        refSchema: (row[2] ?? "").trim(),
        refTable: (row[3] ?? "").trim(),
        refColumns: [],
        onDelete: relationAction(engine, row[5] ?? ""),
        onUpdate: relationAction(engine, row[6] ?? ""),
      };
      groups.set(name.toLowerCase(), item);
      ordered.push(item);
    }
    if (column) item.columns.push(column);
    if (refColumn) item.refColumns.push(refColumn);
  }
  return ordered;
}

export function buildTableStatements(input: {
  engine: EngineKind;
  schema: string;
  name: string;
  creating: boolean;
  previous: ColumnDraft[];
  next: ColumnDraft[];
  primaryKey: string;
  previousIndexes: IndexDraft[];
  nextIndexes: IndexDraft[];
  previousRelations: RelationDraft[];
  nextRelations: RelationDraft[];
}): { statements: string[]; error: string } {
  const ready = usable(input.next);
  if (!ready.length) return { statements: [], error: "Add at least one column." };
  const seen = new Set<string>();
  for (const column of ready) {
    const key = column.name.toLowerCase();
    if (seen.has(key)) return { statements: [], error: `Column ${column.name} is listed more than once.` };
    seen.add(key);
  }
  const names = new Set(ready.map((column) => column.name.toLowerCase()));
  const indexError = validateIndexes(input.engine, input.nextIndexes, names);
  if (indexError) return { statements: [], error: indexError };
  const relationError = validateRelations(input.nextRelations, names);
  if (relationError) return { statements: [], error: relationError };
  const renames = columnRenames(input.previous, ready);
  if (input.creating) {
    const statements = [createTableSql(input.engine, input.schema, input.name, ready)];
    statements.push(...commentStatements(input.engine, input.schema, input.name, [], ready));
    statements.push(...input.nextIndexes.map((index) => createIndexSql(input.engine, input.schema, input.name, index)));
    statements.push(...input.nextRelations.map((relation) => createRelationSql(input.engine, input.schema, input.name, relation)));
    return { statements, error: "" };
  }
  const columns = alterTableSql(input.engine, input.schema, input.name, input.previous, ready, input.primaryKey);
  if (columns.error) return columns;
  const droppedRelations = input.previousRelations.filter((relation) => {
    const next = input.nextRelations.find((item) => item.originalName.toLowerCase() === relation.name.toLowerCase());
    return !next || !relationSame(relation, next, renames);
  });
  const droppedIndexes = input.previousIndexes.filter((index) => {
    const next = input.nextIndexes.find((item) => item.originalName.toLowerCase() === index.name.toLowerCase());
    return !next || !indexSame(index, next, renames);
  });
  const createdIndexes = input.nextIndexes.filter((index) => {
    if (!index.originalName) return true;
    const previous = input.previousIndexes.find((item) => item.name.toLowerCase() === index.originalName.toLowerCase());
    return !previous || !indexSame(previous, index, renames);
  });
  const createdRelations = input.nextRelations.filter((relation) => {
    if (!relation.originalName) return true;
    const previous = input.previousRelations.find((item) => item.name.toLowerCase() === relation.originalName.toLowerCase());
    return !previous || !relationSame(previous, relation, renames);
  });
  return {
    statements: [
      ...droppedRelations.map((relation) => dropRelationSql(input.engine, input.schema, input.name, relation.name)),
      ...droppedIndexes.map((index) => dropIndexSql(input.engine, input.schema, input.name, index.name)),
      ...columns.statements,
      ...commentStatements(input.engine, input.schema, input.name, input.previous, ready),
      ...createdIndexes.map((index) => createIndexSql(input.engine, input.schema, input.name, index)),
      ...createdRelations.map((relation) => createRelationSql(input.engine, input.schema, input.name, relation)),
    ],
    error: "",
  };
}

function validateIndexes(engine: EngineKind, indexes: IndexDraft[], columns: Set<string>): string {
  const seen = new Set<string>();
  for (const index of indexes) {
    const name = index.name.trim();
    if (!name) return "Every index needs a name.";
    const key = name.toLowerCase();
    if (seen.has(key)) return `Index ${name} is listed more than once.`;
    seen.add(key);
    if (!index.columns.length) return `Index ${name} needs at least one column.`;
    const used = new Set<string>();
    for (const column of index.columns) {
      const id = column.toLowerCase();
      if (!columns.has(id)) return `Index ${name} uses column ${column}, which is not on the table.`;
      if (used.has(id)) return `Index ${name} lists column ${column} more than once.`;
      used.add(id);
    }
    if (index.unique && !uniqueIndexAllowed(engine, index.kind)) {
      return `A unique ${index.kind} index is not supported.`;
    }
  }
  return "";
}

function validateRelations(relations: RelationDraft[], columns: Set<string>): string {
  const seen = new Set<string>();
  for (const relation of relations) {
    const name = relation.name.trim();
    if (!name) return "Every relationship needs a name.";
    const key = name.toLowerCase();
    if (seen.has(key)) return `Relationship ${name} is listed more than once.`;
    seen.add(key);
    if (!relation.refTable.trim()) return `Relationship ${name} needs a referenced table.`;
    if (!relation.columns.length) return `Relationship ${name} needs at least one column.`;
    if (relation.columns.length !== relation.refColumns.length) {
      return `Relationship ${name} needs the same number of columns on both sides.`;
    }
    for (const column of relation.columns) {
      if (!columns.has(column.toLowerCase())) return `Relationship ${name} uses column ${column}, which is not on the table.`;
    }
    if (relation.refColumns.some((column) => !column.trim())) return `Relationship ${name} needs a referenced column for each local column.`;
  }
  return "";
}

function commentStatements(engine: EngineKind, schema: string, table: string, previous: ColumnDraft[], next: ColumnDraft[]): string[] {
  if (engine === "mysql") return [];
  const statements: string[] = [];
  for (const column of next) {
    const old = previous.find((item) => item.name.toLowerCase() === (column.originalName || column.name).toLowerCase());
    const before = (old?.comment ?? "").trim();
    const after = column.comment.trim();
    if (before === after) continue;
    const statement = columnCommentStatement(engine, schema, table, column.name, before, after);
    if (statement) statements.push(statement);
  }
  return statements;
}

function columnCommentStatement(engine: EngineKind, schema: string, table: string, column: string, previous: string, next: string): string | null {
  if (engine === "postgres") {
    const target = `${qualify(engine, schema, table)}.${quoteIdent(engine, column)}`;
    return next ? `COMMENT ON COLUMN ${target} IS ${sqlLiteral(engine, next)}` : `COMMENT ON COLUMN ${target} IS NULL`;
  }
  const levels = `@level0type=N'SCHEMA', @level0name=${sqlLiteral(engine, schema)}, @level1type=N'TABLE', @level1name=${sqlLiteral(engine, table)}, @level2type=N'COLUMN', @level2name=${sqlLiteral(engine, column)}`;
  if (!next) return `EXEC sys.sp_dropextendedproperty @name=N'MS_Description', ${levels}`;
  if (!previous) return `EXEC sys.sp_addextendedproperty @name=N'MS_Description', @value=${sqlLiteral(engine, next)}, ${levels}`;
  return `EXEC sys.sp_updateextendedproperty @name=N'MS_Description', @value=${sqlLiteral(engine, next)}, ${levels}`;
}

function createIndexSql(engine: EngineKind, schema: string, table: string, index: IndexDraft): string {
  const name = quoteIdent(engine, index.name.trim());
  const target = qualify(engine, schema, table);
  const columns = index.columns.map((column) => quoteIdent(engine, column)).join(", ");
  if (engine === "mssql") {
    const unique = index.unique ? "UNIQUE " : "";
    return `CREATE ${unique}${index.kind} INDEX ${name} ON ${target} (${columns})`;
  }
  if (engine === "postgres") {
    const unique = index.unique ? "UNIQUE " : "";
    return `CREATE ${unique}INDEX ${name} ON ${target} USING ${index.kind} (${columns})`;
  }
  const kind = index.kind.toUpperCase();
  if (kind === "FULLTEXT") return `CREATE FULLTEXT INDEX ${name} ON ${target} (${columns})`;
  if (kind === "SPATIAL") return `CREATE SPATIAL INDEX ${name} ON ${target} (${columns})`;
  const unique = index.unique ? "UNIQUE " : "";
  return `CREATE ${unique}INDEX ${name} ON ${target} (${columns}) USING ${kind}`;
}

function dropIndexSql(engine: EngineKind, schema: string, table: string, name: string): string {
  if (engine === "postgres") return `DROP INDEX ${qualify(engine, schema, name)}`;
  return `DROP INDEX ${quoteIdent(engine, name)} ON ${qualify(engine, schema, table)}`;
}

function createRelationSql(engine: EngineKind, schema: string, table: string, relation: RelationDraft): string {
  const target = qualify(engine, schema, table);
  const name = quoteIdent(engine, relation.name.trim());
  const columns = relation.columns.map((column) => quoteIdent(engine, column)).join(", ");
  const referenced = relation.refColumns.map((column) => quoteIdent(engine, column)).join(", ");
  const refTable = referenceTable(engine, relation.refSchema, relation.refTable.trim());
  return `ALTER TABLE ${target} ADD CONSTRAINT ${name} FOREIGN KEY (${columns}) REFERENCES ${refTable} (${referenced}) ON DELETE ${relation.onDelete} ON UPDATE ${relation.onUpdate}`;
}

function referenceTable(engine: EngineKind, schema: string, table: string): string {
  if (engine === "mysql" && schema.trim()) return `${quoteIdent(engine, schema)}.${quoteIdent(engine, table)}`;
  return qualify(engine, schema, table);
}

function dropRelationSql(engine: EngineKind, schema: string, table: string, name: string): string {
  const target = qualify(engine, schema, table);
  if (engine === "mysql") return `ALTER TABLE ${target} DROP FOREIGN KEY ${quoteIdent(engine, name)}`;
  return `ALTER TABLE ${target} DROP CONSTRAINT ${quoteIdent(engine, name)}`;
}

function indexSame(previous: IndexDraft, next: IndexDraft, renames: Map<string, string>): boolean {
  return (
    previous.name === next.name &&
    previous.unique === next.unique &&
    previous.kind.toLowerCase() === next.kind.toLowerCase() &&
    sameList(mapped(previous.columns, renames), next.columns)
  );
}

function relationSame(previous: RelationDraft, next: RelationDraft, renames: Map<string, string>): boolean {
  return (
    previous.name === next.name &&
    previous.refSchema.toLowerCase() === next.refSchema.toLowerCase() &&
    previous.refTable.toLowerCase() === next.refTable.toLowerCase() &&
    previous.onDelete === next.onDelete &&
    previous.onUpdate === next.onUpdate &&
    sameList(mapped(previous.columns, renames), next.columns) &&
    sameList(previous.refColumns, next.refColumns)
  );
}

function columnRenames(previous: ColumnDraft[], next: ColumnDraft[]): Map<string, string> {
  const known = new Set(previous.map((column) => column.name.toLowerCase()));
  const renames = new Map<string, string>();
  for (const column of next) {
    if (!column.originalName || !known.has(column.originalName.toLowerCase())) continue;
    renames.set(column.originalName.toLowerCase(), column.name);
  }
  return renames;
}

function mapped(columns: string[], renames: Map<string, string>): string[] {
  return columns.map((column) => renames.get(column.toLowerCase()) ?? column);
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value.toLowerCase() === right[index].toLowerCase());
}

function relationAction(engine: EngineKind, value: string): string {
  const raw = value.trim();
  if (engine === "postgres" && raw.length === 1) {
    const actions: Record<string, string> = { a: "NO ACTION", r: "RESTRICT", c: "CASCADE", n: "SET NULL", d: "SET DEFAULT" };
    return actions[raw.toLowerCase()] ?? "NO ACTION";
  }
  const normalized = raw.toUpperCase().split("_").join(" ");
  if (relationActions(engine).includes(normalized)) return normalized;
  if (normalized === "SET DEFAULT") return "SET DEFAULT";
  return "NO ACTION";
}

function truthy(value: string | null): boolean {
  const text = (value ?? "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "t" || text === "yes";
}

function sqlLiteral(engine: EngineKind, value: string): string {
  const body = engine === "mysql" ? value.split("\\").join("\\\\").split("'").join("''") : value.split("'").join("''");
  return engine === "mssql" ? `N'${body}'` : `'${body}'`;
}

function embed(value: string): string {
  return value.split("'").join("''");
}

function mssqlSys(database: string): string {
  const name = database.trim();
  return name ? `${quoteIdent("mssql", name)}.sys` : "sys";
}

function mssqlObjectId(database: string, schema: string, table: string): string {
  const parts = [schema, table];
  const name = database.trim();
  if (name) parts.unshift(name);
  return `N'${embed(parts.map((part) => quoteIdent("mssql", part)).join("."))}'`;
}

function mysqlSchemaExpr(database: string): string {
  const name = database.trim();
  return name ? `'${embed(name)}'` : "DATABASE()";
}
