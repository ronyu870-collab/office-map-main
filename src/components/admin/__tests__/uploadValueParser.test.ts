import { describe, expect, it } from 'vitest'
import type { ColDef } from '../types'
import { parseUploadCellValue } from '../uploadValueParser'

function col(type: ColDef['type']): ColDef {
  return { key: 'field', label: '测试字段', type }
}

describe('parseUploadCellValue', () => {
  it.each<ColDef['type']>([
    'text',
    'textarea',
    'tags',
    'number',
    'boolean',
    'date',
    'jsonb',
    'uuid',
  ])('所有类型留空时都跳过写入：%s', type => {
    expect(parseUploadCellValue(col(type), '   ')).toEqual({ kind: 'skip' })
  })

  it('只返回实际填写的文本，避免空白覆盖数据库原值', () => {
    expect(parseUploadCellValue(col('text'), '  北京市  ')).toEqual({
      kind: 'value',
      value: '北京市',
    })
  })

  it('正确解析数字、布尔值和曾用名', () => {
    expect(parseUploadCellValue(col('number'), ' 12.5 ')).toEqual({
      kind: 'value',
      value: 12.5,
    })
    expect(parseUploadCellValue(col('boolean'), '否')).toEqual({
      kind: 'value',
      value: false,
    })
    expect(parseUploadCellValue(col('tags'), '旧名称A，旧名称B')).toEqual({
      kind: 'value',
      value: ['旧名称A', '旧名称B'],
    })
  })

  it('拒绝无法识别的数字和布尔值', () => {
    expect(parseUploadCellValue(col('number'), '一百')).toMatchObject({ kind: 'error' })
    expect(parseUploadCellValue(col('boolean'), '默认')).toMatchObject({ kind: 'error' })
  })
})
