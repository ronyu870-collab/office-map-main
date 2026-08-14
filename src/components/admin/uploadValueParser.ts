import type { ColDef } from './types'

export type UploadCellParseResult =
  | { kind: 'skip' }
  | { kind: 'value'; value: unknown }
  | { kind: 'error'; message: string }

/**
 * 管理后台批量上传的统一单元格规则：
 * - 留空：不进入写入 payload；更新时保留原值，新增时交给数据库默认值。
 * - 填写：按列类型转换后写入。
 *
 * 批量上传不承担“清空字段”的职责。需要清空时，应使用表格中的单条编辑，
 * 避免管理员把“没填”误解成“删除原值”。
 */
export function parseUploadCellValue(
  col: ColDef,
  rawValue: string,
): UploadCellParseResult {
  const raw = rawValue.trim()
  if (raw === '') return { kind: 'skip' }

  if (col.type === 'number') {
    const value = Number(raw)
    if (Number.isNaN(value)) {
      return { kind: 'error', message: `格式错误（应为数字，实际为 '${raw}'）` }
    }
    return { kind: 'value', value }
  }

  if (col.type === 'boolean') {
    const truthy = new Set(['true', '1', '是'])
    const falsy = new Set(['false', '0', '否'])
    if (truthy.has(raw)) return { kind: 'value', value: true }
    if (falsy.has(raw)) return { kind: 'value', value: false }
    return { kind: 'error', message: `格式错误（请填写“是”或“否”，实际为 '${raw}'）` }
  }

  if (col.type === 'tags') {
    const tags = raw.split(/[,，、]/).map(value => value.trim()).filter(Boolean)
    return tags.length > 0 ? { kind: 'value', value: tags } : { kind: 'skip' }
  }

  return { kind: 'value', value: raw }
}
