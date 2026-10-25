import type { ColDef, DictBundle, TableConfig } from '../types'

export type GridRecord = Record<string, any>
export const copyRecord = (row: GridRecord): GridRecord => structuredClone(row)

/** A single identity for the grid, mobile list and selection, including tables without id. */
export function gridRowKey(config: TableConfig, row: GridRecord): string {
  if (row.id != null) return String(row.id)
  const keys = config.uploadMatchKeys?.length ? config.uploadMatchKeys : row.user_id != null ? ['user_id'] : ['building_id']
  if (keys.every(key => row[key] != null)) return JSON.stringify(keys.map(key => [key, row[key]]))
  // Unkeyed discovery rows still need distinct, stable display identities. They are
  // not used as write predicates: persistence requires a known locator below.
  const value = canonical(row)
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619)
  return `unkeyed:${value.length}:${hash >>> 0}`
}

export function writableColumns(config: TableConfig) {
  return config.cols.filter(col => !col.readOnly && !col.sourceKey)
}

function normalized(col: ColDef, value: any): any {
  if (value === '' || value == null) return null
  if (col.type === 'number') return Number(value)
  if (col.type === 'boolean') return value === true || value === 'true'
  if (col.type === 'jsonb' && typeof value === 'string') {
    try { return JSON.parse(value) } catch { return value }
  }
  return value
}
const canonical = (value: any): string => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry)

export function recordIsDirty(config: TableConfig, original: GridRecord, current: GridRecord) {
  return writableColumns(config).some(col => canonical(normalized(col, original[col.key])) !== canonical(normalized(col, current[col.key])))
}

export function recordPayload(config: TableConfig, values: GridRecord) {
  const payload: GridRecord = {}
  const errors: Record<string, string> = {}
  for (const col of writableColumns(config)) {
    const value = normalized(col, values[col.key])
    if (col.required && value == null) errors[col.key] = `${col.label}为必填项`
    else if (col.type === 'number' && value != null && !Number.isFinite(value)) errors[col.key] = `${col.label}请输入有效数字`
    else if (col.type === 'jsonb' && value != null && typeof values[col.key] === 'string') {
      try { JSON.parse(values[col.key]) } catch { errors[col.key] = `${col.label} JSON 格式错误` }
    }
    payload[col.key] = ['number', 'boolean', 'jsonb', 'date'].includes(col.type) ? value : values[col.key]
  }
  return { payload, errors }
}

export function displayRecordValue(col: ColDef, row: GridRecord, dicts: DictBundle): string {
  const value = row[col.sourceKey ?? col.key]
  if (value == null || value === '') return '—'
  if (col.foreignKey) return dicts[col.foreignKey]?.[String(value)] ?? String(value)
  if (col.displayMap) return col.displayMap[String(value)] ?? String(value)
  if (col.type === 'boolean') return value === true || value === 'true' ? '是' : '否'
  if (col.type === 'number' && Number.isFinite(Number(value))) {
    const num = Number(value) * (col.suffix ? 100 : 1)
    const fixed = col.decimals != null ? num.toFixed(col.decimals) : String(num)
    const [int, decimal] = fixed.split('.')
    return (col.noThousandSeparator ? int : int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')) + (decimal != null ? `.${decimal}` : '') + (col.suffix ?? '')
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}
