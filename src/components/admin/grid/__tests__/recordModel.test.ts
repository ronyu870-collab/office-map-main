import { describe, it, expect } from 'vitest'
import { gridRowKey, recordIsDirty, recordPayload, displayRecordValue } from '../recordModel'
import type { TableConfig } from '../../types'
const config: TableConfig = { table: 'synthetic', label: '测试', cols: [
  { key: 'amount', label: '面积', type: 'number', required: true },
  { key: 'enabled', label: '启用', type: 'boolean', required: true },
  { key: 'name', label: '名称', type: 'text', required: true },
  { key: 'json', label: '配置', type: 'jsonb' },
  { key: 'computed', label: '派生', type: 'text', sourceKey: 'name' },
  { key: 'id', label: 'ID', type: 'uuid', readOnly: true },
] }
describe('record editing values and identity', () => {
  it('keeps zero and false, parses existing JSON objects and excludes read-only/derived fields', () => {
    const result = recordPayload(config, { amount: '0', enabled: false, name: '示例', json: { b: 2 }, id: 'id', computed: 'do-not-write' })
    expect(result.errors).toEqual({})
    expect(result.payload).toEqual({ amount: 0, enabled: false, name: '示例', json: { b: 2 } })
  })
  it('detects actual differences and treats a reverted input as clean', () => {
    const original = { amount: 0, enabled: false, name: '甲', json: { b: 2, a: 1 } }
    expect(recordIsDirty(config, original, { ...original, amount: '0', json: '{"a":1,"b":2}' })).toBe(false)
    expect(recordIsDirty(config, original, { ...original, amount: '1' })).toBe(true)
    expect(recordIsDirty(config, original, { ...original, enabled: true })).toBe(true)
  })
  it('validates missing, invalid numeric and malformed JSON without replacing input', () => {
    const values = { name: '', amount: 'invalid', enabled: false, json: '{' }
    const result = recordPayload(config, values)
    expect(Object.keys(result.errors)).toEqual(['amount', 'name', 'json'])
    expect(values.json).toBe('{')
  })
  it('does not conflate records of one building across composite periods', () => {
    const cfg = { ...config, uploadMatchKeys: ['building_id', 'year', 'quarter'] }
    expect(gridRowKey(cfg, { building_id: 'b', year: 2026, quarter: 1 })).not.toEqual(gridRowKey(cfg, { building_id: 'b', year: 2026, quarter: 2 }))
    expect(gridRowKey(config, { name: '甲' })).not.toEqual(gridRowKey(config, { name: '乙' }))
    expect(gridRowKey(config, { user_id: 'u1' })).not.toEqual(gridRowKey(config, { user_id: 'u2' }))
  })
  it('keeps mobile numeric display aligned with the desktop renderer without rounding stored values', () => {
    const col = { key: 'rate', label: '空置率', type: 'number' as const, decimals: 1, suffix: '%' }
    const row = { rate: 0.12345 }
    expect(displayRecordValue(col, row, {})).toBe('12.3%')
    expect(displayRecordValue(col, { rate: 0 }, {})).toBe('0.0%')
    expect(displayRecordValue(col, { rate: null }, {})).toBe('—')
    expect(row.rate).toBe(0.12345)
  })
})
