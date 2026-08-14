import { supabase } from '@/src/services/supabaseClient'
import { pgTypeToColType, SYSTEM_COLUMNS, READONLY_COLUMNS } from './types'
import type { TableConfig, ColDef } from './types'

// ─── 缓存 ────────────────────────────────────────────────────────────────────

let cachedTables: TableConfig[] | null = null
let cachePromise: Promise<TableConfig[]> | null = null

// ─── 核心发现逻辑 ────────────────────────────────────────────────────────────

export async function discoverAutoTables(
  hardcodedTables: string[]
): Promise<TableConfig[]> {
  if (cachedTables) return cachedTables
  if (cachePromise) return cachePromise

  cachePromise = doDiscovery(hardcodedTables)
  cachedTables = await cachePromise
  return cachedTables
}

async function doDiscovery(hardcodedTables: string[]): Promise<TableConfig[]> {
  const skipSet = new Set([...hardcodedTables, 'view_latest_quarterly_submissions'])

  // 1. 获取所有表
  const { data: tables, error: tablesErr } = await supabase.rpc('get_all_tables')
  if (tablesErr || !tables) {
    console.error('[schemaDiscovery] get_all_tables failed:', tablesErr)
    return []
  }

  const autoTableNames = tables
    .map((t: any) => t.table_name as string)
    .filter((name: string) => !skipSet.has(name))

  // 2. 对每张表获取列信息
  const results: TableConfig[] = []

  for (const tableName of autoTableNames) {
    const { data: columns, error: colsErr } = await supabase
      .rpc('get_table_columns', { target_table: tableName })

    if (colsErr || !columns) {
      console.error(`[schemaDiscovery] get_table_columns(${tableName}) failed:`, colsErr)
      continue
    }

    // 超过15列的表，只显示前10列，其余隐藏
    const shouldHideAfter = 10
    const cols: ColDef[] = columns.map((col: any, idx: number) => ({
      key: col.column_name,
      label: col.column_comment || col.column_name,
      type: pgTypeToColType(col.data_type),
      readOnly: READONLY_COLUMNS.has(col.column_name) || col.column_default?.includes('gen_random_uuid'),
      hidden: SYSTEM_COLUMNS.has(col.column_name) || (idx >= shouldHideAfter && !isKeyColumn(col.column_name)),
      masked: false,
    }))

    const tableComment = tables.find((t: any) => t.table_name === tableName)?.table_comment || ''

    results.push({
      table: tableName,
      label: tableComment || tableName,
      emoji: '',
      cols,
      orderBy: findOrderByColumn(cols),
    })
  }

  return results
}

/** 判断是否为关键列（不应被隐藏） */
function isKeyColumn(colName: string): boolean {
  const keyPatterns = ['name', 'title', 'label', 'company', 'building', 'user', 'status']
  const lower = colName.toLowerCase()
  return keyPatterns.some(p => lower.includes(p))
}

/** 找到合适的默认排序列 */
function findOrderByColumn(cols: ColDef[]): string {
  const preferOrder = ['created_at', 'name', 'title', 'id']
  for (const pref of preferOrder) {
    if (cols.some(c => c.key === pref)) return pref
  }
  return cols[0]?.key || 'id'
}

/** 重置缓存（用于调试或表结构变更后） */
export function resetSchemaCache(): void {
  cachedTables = null
  cachePromise = null
}
