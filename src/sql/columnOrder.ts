import { quoteIdent } from "../types";

/** Rebuild ordinary SQL Server tables in one transaction using server metadata.
 * Features we cannot reproduce exactly are rejected before changing the table.
 */
export function reorderMssqlColumns(schema: string, table: string, columns: string[]): string {
  const literal = (text: string) => `N'${text.replace(/'/g, "''")}'`;
  const target = `${quoteIdent("mssql", schema)}.${quoteIdent("mssql", table)}`;
  const names = columns.map((name) => quoteIdent("mssql", name)).join(", ");
  const requested = columns.map((name, index) => `(${index}, ${literal(name)})`).join(", ");
  return `IF @@TRANCOUNT <> 0 THROW 50000, 'Finish the active transaction before reordering columns.', 1;
DECLARE @hadXactAbort bit = CASE WHEN @@OPTIONS & 16384 = 16384 THEN 1 ELSE 0 END;
SET XACT_ABORT ON;
BEGIN TRY
  BEGIN TRANSACTION;
  DECLARE @target nvarchar(517) = ${literal(target)}, @id int = OBJECT_ID(${literal(target)}, 'U');
  IF @id IS NULL THROW 50000, 'Table no longer exists.', 1;
  DECLARE @count bigint, @sql nvarchar(max);
  SET @sql = N'SELECT @n = COUNT_BIG(*) FROM ' + @target + N' WITH (TABLOCKX, HOLDLOCK)';
  EXEC sys.sp_executesql @sql, N'@n bigint OUTPUT', @n = @count OUTPUT;
  DECLARE @order TABLE (position int, name sysname);
  INSERT INTO @order VALUES ${requested};
  IF (SELECT COUNT(*) FROM sys.columns WHERE object_id = @id) <> (SELECT COUNT(*) FROM @order)
     OR EXISTS (SELECT name FROM @order EXCEPT SELECT name FROM sys.columns WHERE object_id = @id)
    THROW 50000, 'Table columns changed. Reopen the designer and try again.', 1;
  IF ISNULL(HAS_PERMS_BY_NAME(DB_NAME(), 'DATABASE', 'VIEW DEFINITION'), 0) <> 1
    THROW 50000, 'Reordering requires database VIEW DEFINITION permission to inspect dependencies.', 1;
  IF EXISTS (SELECT 1 FROM sys.tables WHERE object_id = @id AND
      (temporal_type <> 0 OR is_memory_optimized = 1 OR is_filetable = 1 OR is_replicated = 1 OR is_merge_published = 1 OR is_sync_tran_subscribed = 1 OR is_tracked_by_cdc = 1 OR is_remote_data_archive_enabled = 1 OR filestream_data_space_id IS NOT NULL OR principal_id IS NOT NULL OR large_value_types_out_of_row = 1 OR text_in_row_limit <> 0 OR lock_escalation <> 0 OR lock_on_bulk_load = 1 OR uses_ansi_nulls = 0))
     OR EXISTS (SELECT 1 FROM sys.columns WHERE object_id = @id AND
      (is_computed = 1 OR is_sparse = 1 OR is_column_set = 1 OR is_filestream = 1 OR generated_always_type <> 0 OR encryption_type IS NOT NULL OR is_hidden = 1 OR system_type_id = 189 OR is_ansi_padded = 0 AND system_type_id IN (165, 167, 173, 175) OR default_object_id <> 0 AND NOT EXISTS (SELECT 1 FROM sys.default_constraints d WHERE d.object_id = sys.columns.default_object_id) OR rule_object_id <> 0))
     OR EXISTS (SELECT 1 FROM sys.masked_columns WHERE object_id = @id AND is_masked = 1)
     OR EXISTS (SELECT 1 FROM sys.identity_columns WHERE object_id = @id AND is_not_for_replication = 1)
     OR EXISTS (SELECT 1 FROM sys.extended_properties WHERE major_id IN
       (SELECT object_id FROM sys.objects WHERE parent_object_id = @id UNION SELECT object_id FROM sys.foreign_keys WHERE referenced_object_id = @id))
     OR EXISTS (SELECT 1 FROM sys.triggers WHERE parent_id = @id)
     OR EXISTS (SELECT 1 FROM sys.database_permissions WHERE class = 1 AND major_id = @id)
     OR EXISTS (SELECT 1 FROM sys.change_tracking_tables WHERE object_id = @id)
     OR EXISTS (SELECT 1 FROM sys.fulltext_indexes WHERE object_id = @id)
     OR EXISTS (SELECT 1 FROM sys.security_predicates WHERE target_object_id = @id)
     OR EXISTS (SELECT 1 FROM sys.sql_expression_dependencies WHERE referenced_id = @id AND referencing_id <> @id AND referencing_id NOT IN
        (SELECT object_id FROM sys.objects WHERE parent_object_id = @id))
     OR EXISTS (SELECT 1 FROM sys.stats WHERE object_id = @id AND user_created = 1)
     OR EXISTS (SELECT 1 FROM sys.partitions WHERE object_id = @id AND (partition_number > 1 OR data_compression <> 0))
     OR EXISTS (SELECT 1 FROM sys.tables t JOIN sys.indexes i ON i.object_id = t.object_id AND i.index_id IN (0, 1)
       WHERE t.object_id = @id AND t.lob_data_space_id <> 0 AND t.lob_data_space_id <> i.data_space_id)
     OR EXISTS (SELECT 1 FROM sys.indexes i LEFT JOIN sys.data_spaces ds ON ds.data_space_id = i.data_space_id
       WHERE i.object_id = @id AND (i.type NOT IN (0, 1, 2) OR i.is_disabled = 1 OR ds.type <> 'FG'))
    THROW 50000, 'This table has dependencies or advanced features that cannot be safely preserved by the designer. Use a reviewed migration to reorder its columns.', 1;

  DECLARE @commands TABLE (phase int, sql nvarchar(max));
  INSERT INTO @commands
  SELECT 20, N'ALTER TABLE ' + @target + N' ADD CONSTRAINT ' + QUOTENAME(d.name) + N' DEFAULT ' + d.definition + N' FOR ' + QUOTENAME(c.name)
    FROM sys.default_constraints d JOIN sys.columns c ON c.object_id = d.parent_object_id AND c.column_id = d.parent_column_id
    WHERE d.parent_object_id = @id;
  INSERT INTO @commands
  SELECT 20, N'ALTER TABLE ' + @target + CASE WHEN is_not_trusted = 1 THEN N' WITH NOCHECK' ELSE N' WITH CHECK' END
    + N' ADD CONSTRAINT ' + QUOTENAME(name) + N' CHECK ' + CASE WHEN is_not_for_replication = 1 THEN N'NOT FOR REPLICATION ' ELSE N'' END + definition
    + N'; ALTER TABLE ' + @target + CASE WHEN is_disabled = 1 THEN N' NOCHECK' ELSE N' CHECK' END + N' CONSTRAINT ' + QUOTENAME(name)
    FROM sys.check_constraints WHERE parent_object_id = @id;

  INSERT INTO @commands
  SELECT 10, CASE WHEN i.is_primary_key = 1 OR i.is_unique_constraint = 1
      THEN N'ALTER TABLE ' + @target + N' ADD CONSTRAINT ' + QUOTENAME(i.name) + CASE WHEN i.is_primary_key = 1 THEN N' PRIMARY KEY ' ELSE N' UNIQUE ' END
      ELSE N'CREATE ' + CASE WHEN i.is_unique = 1 THEN N'UNIQUE ' ELSE N'' END END
    + CASE WHEN i.type = 1 THEN N'CLUSTERED ' ELSE N'NONCLUSTERED ' END
    + CASE WHEN i.is_primary_key = 1 OR i.is_unique_constraint = 1 THEN N'' ELSE N'INDEX ' + QUOTENAME(i.name) + N' ON ' + @target END
    + N' (' + STUFF((SELECT N', ' + QUOTENAME(c.name) + CASE WHEN ic.is_descending_key = 1 THEN N' DESC' ELSE N' ASC' END
        FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.key_ordinal > 0 ORDER BY ic.key_ordinal FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') + N')'
    + CASE WHEN EXISTS (SELECT 1 FROM sys.index_columns WHERE object_id = i.object_id AND index_id = i.index_id AND is_included_column = 1)
      THEN N' INCLUDE (' + STUFF((SELECT N', ' + QUOTENAME(c.name) FROM sys.index_columns ic JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
        WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 1 ORDER BY ic.index_column_id FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') + N')' ELSE N'' END
    + CASE WHEN i.has_filter = 1 THEN N' WHERE ' + i.filter_definition ELSE N'' END
    + N' WITH (PAD_INDEX = ' + CASE WHEN i.is_padded = 1 THEN N'ON' ELSE N'OFF' END
    + N', FILLFACTOR = ' + CONVERT(nvarchar(3), i.fill_factor)
    + N', IGNORE_DUP_KEY = ' + CASE WHEN i.ignore_dup_key = 1 THEN N'ON' ELSE N'OFF' END
    + N', STATISTICS_NORECOMPUTE = ' + CASE WHEN s.no_recompute = 1 THEN N'ON' ELSE N'OFF' END
    + N', ALLOW_ROW_LOCKS = ' + CASE WHEN i.allow_row_locks = 1 THEN N'ON' ELSE N'OFF' END
    + N', ALLOW_PAGE_LOCKS = ' + CASE WHEN i.allow_page_locks = 1 THEN N'ON' ELSE N'OFF' END + N') ON ' + QUOTENAME(ds.name)
    FROM sys.indexes i JOIN sys.stats s ON s.object_id = i.object_id AND s.stats_id = i.index_id
    JOIN sys.data_spaces ds ON ds.data_space_id = i.data_space_id WHERE i.object_id = @id AND i.index_id > 0;

  INSERT INTO @commands
  SELECT 0, N'ALTER TABLE ' + QUOTENAME(OBJECT_SCHEMA_NAME(parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(parent_object_id)) + N' DROP CONSTRAINT ' + QUOTENAME(name)
    FROM sys.foreign_keys WHERE parent_object_id = @id OR referenced_object_id = @id;
  INSERT INTO @commands
  SELECT 30, N'ALTER TABLE ' + p.name + CASE WHEN f.is_not_trusted = 1 THEN N' WITH NOCHECK' ELSE N' WITH CHECK' END + N' ADD CONSTRAINT ' + QUOTENAME(f.name)
    + N' FOREIGN KEY (' + STUFF((SELECT N', ' + QUOTENAME(COL_NAME(fc.parent_object_id, fc.parent_column_id)) FROM sys.foreign_key_columns fc
        WHERE fc.constraint_object_id = f.object_id ORDER BY fc.constraint_column_id FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'')
    + N') REFERENCES ' + QUOTENAME(OBJECT_SCHEMA_NAME(f.referenced_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(f.referenced_object_id))
    + N' (' + STUFF((SELECT N', ' + QUOTENAME(COL_NAME(fc.referenced_object_id, fc.referenced_column_id)) FROM sys.foreign_key_columns fc
        WHERE fc.constraint_object_id = f.object_id ORDER BY fc.constraint_column_id FOR XML PATH(''), TYPE).value('.', 'nvarchar(max)'), 1, 2, N'') + N')'
    + N' ON DELETE ' + REPLACE(f.delete_referential_action_desc, '_', ' ') + N' ON UPDATE ' + REPLACE(f.update_referential_action_desc, '_', ' ')
    + CASE WHEN f.is_not_for_replication = 1 THEN N' NOT FOR REPLICATION' ELSE N'' END
    + N'; ALTER TABLE ' + p.name + CASE WHEN f.is_disabled = 1 THEN N' NOCHECK' ELSE N' CHECK' END + N' CONSTRAINT ' + QUOTENAME(f.name)
    FROM sys.foreign_keys f CROSS APPLY (SELECT QUOTENAME(OBJECT_SCHEMA_NAME(f.parent_object_id)) + N'.' + QUOTENAME(OBJECT_NAME(f.parent_object_id)) AS name) p
    WHERE f.parent_object_id = @id OR f.referenced_object_id = @id;

  DECLARE @properties TABLE (name sysname, value sql_variant, column_name sysname);
  INSERT INTO @properties SELECT ep.name, ep.value, c.name FROM sys.extended_properties ep
    LEFT JOIN sys.columns c ON c.object_id = ep.major_id AND c.column_id = ep.minor_id
    WHERE ep.class = 1 AND ep.major_id = @id;
  IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 7 AND major_id = @id)
    THROW 50000, 'Index extended properties require a reviewed migration.', 1;
  DECLARE @temp sysname = N'__dbmanager_reorder_' + REPLACE(CONVERT(nvarchar(36), NEWID()), '-', ''), @tempTarget nvarchar(517);
  SET @tempTarget = QUOTENAME(${literal(schema)}) + N'.' + QUOTENAME(@temp);
  DECLARE @identityLast nvarchar(100) = (SELECT CONVERT(nvarchar(100), CONVERT(decimal(38,0), last_value)
    + CASE WHEN @count = 0 THEN CONVERT(decimal(38,0), increment_value) ELSE 0 END) FROM sys.identity_columns WHERE object_id = @id);
  DECLARE @filegroup sysname = (SELECT TOP (1) ds.name FROM sys.indexes i JOIN sys.data_spaces ds ON ds.data_space_id = i.data_space_id WHERE i.object_id = @id ORDER BY i.index_id);
  SET @sql = N'SELECT ${names.replace(/'/g, "''")} INTO ' + @tempTarget + N' ON ' + QUOTENAME(@filegroup) + N' FROM ' + @target;
  EXEC sys.sp_executesql @sql;
  DECLARE commands CURSOR LOCAL FAST_FORWARD FOR SELECT sql FROM @commands WHERE phase = 0;
  OPEN commands; FETCH NEXT FROM commands INTO @sql;
  WHILE @@FETCH_STATUS = 0 BEGIN EXEC sys.sp_executesql @sql; FETCH NEXT FROM commands INTO @sql; END;
  CLOSE commands; DEALLOCATE commands;
  SET @sql = N'DROP TABLE ' + @target; EXEC sys.sp_executesql @sql;
  EXEC sys.sp_rename @objname = @tempTarget, @newname = ${literal(table)}, @objtype = N'OBJECT';
  IF @identityLast IS NOT NULL BEGIN
    SET @sql = N'DBCC CHECKIDENT (' + QUOTENAME(@target, '''') + N', RESEED, ' + @identityLast + N') WITH NO_INFOMSGS';
    EXEC sys.sp_executesql @sql;
  END;
  DECLARE restore_commands CURSOR LOCAL FAST_FORWARD FOR SELECT sql FROM @commands WHERE phase > 0 ORDER BY phase;
  OPEN restore_commands; FETCH NEXT FROM restore_commands INTO @sql;
  WHILE @@FETCH_STATUS = 0 BEGIN EXEC sys.sp_executesql @sql; FETCH NEXT FROM restore_commands INTO @sql; END;
  CLOSE restore_commands; DEALLOCATE restore_commands;
  DECLARE @property sysname, @value sql_variant, @column sysname;
  DECLARE properties CURSOR LOCAL FAST_FORWARD FOR SELECT name, value, column_name FROM @properties;
  OPEN properties; FETCH NEXT FROM properties INTO @property, @value, @column;
  WHILE @@FETCH_STATUS = 0 BEGIN
    IF @column IS NULL EXEC sys.sp_addextendedproperty @name=@property, @value=@value, @level0type=N'SCHEMA', @level0name=${literal(schema)}, @level1type=N'TABLE', @level1name=${literal(table)};
    ELSE EXEC sys.sp_addextendedproperty @name=@property, @value=@value, @level0type=N'SCHEMA', @level0name=${literal(schema)}, @level1type=N'TABLE', @level1name=${literal(table)}, @level2type=N'COLUMN', @level2name=@column;
    FETCH NEXT FROM properties INTO @property, @value, @column;
  END;
  CLOSE properties; DEALLOCATE properties;
  COMMIT TRANSACTION;
  IF @hadXactAbort = 0 SET XACT_ABORT OFF;
END TRY
BEGIN CATCH
  IF XACT_STATE() <> 0 ROLLBACK TRANSACTION;
  IF @hadXactAbort = 0 SET XACT_ABORT OFF;
  THROW;
END CATCH`;
}
