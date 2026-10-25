import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableConfig } from '../../types'
const state = vi.hoisted(() => ({ persist: vi.fn(), traces: [] as unknown[][] }))
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: (table: string) => {
  const query: any = { insert: (data: any) => { state.traces.push(['insert', table, data]); return query }, update: (data: any) => { state.traces.push(['update', table, data]); return query }, eq: (key: string, value: any) => { state.traces.push(['eq', key, value]); return query }, select: () => state.persist() }
  return query
} } }))
vi.mock('@/src/services/Auth', () => ({ getSession: async () => ({ user: { id: 'synthetic-user' } }) }))
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }))
import { useGridCrud } from '../useGridCrud'
const config: TableConfig = { table: 'synthetic', label: '测试', cols: [{ key: 'name', label: '名称', type: 'text', required: true }, { key: 'amount', label: '面积', type: 'number' }, { key: 'settings', label: '配置', type: 'jsonb' }] }
const row = { id: 'row-1', name: '原值', amount: 10, settings: { enabled: true }, updated_at: 'version-1' }
function setup(refresh = vi.fn(async () => true)) {
  const toast = vi.fn()
  const hook = renderHook(() => useGridCrud(config, {}, [row], refresh, toast))
  return { ...hook, refresh, toast }
}
beforeEach(() => { state.traces = []; state.persist.mockReset(); state.persist.mockResolvedValue({ data: [row], error: null }) })
describe('shared grid write session', () => {
  it('captures synchronously, validates and writes using the original version', async () => {
    const { result } = setup()
    act(() => result.current.startEdit(row))
    act(() => result.current.forceSyncBuf({ ...row, name: '修改值', amount: '0' }))
    expect(result.current.isDirty()).toBe(true)
    let saved: boolean | undefined
    await act(async () => { saved = await result.current.saveEdit() })
    expect(saved).toBe(true)
    expect(state.traces).toContainEqual(['eq', 'updated_at', 'version-1'])
    expect(state.traces).toContainEqual(['update', 'synthetic', { name: '修改值', amount: 0, settings: { enabled: true } }])
    expect(result.current.editingId).toBeNull()
  })
  it.each(['reject', 'empty'])('retains editing buffer on %s and allows retry', async failure => {
    const { result } = setup()
    act(() => result.current.startEdit(row))
    act(() => result.current.setEditBuf({ ...row, name: '继续保留' }))
    if (failure === 'reject') state.persist.mockRejectedValueOnce(new Error('离线'))
    else state.persist.mockResolvedValueOnce({ data: [], error: null })
    await act(async () => { expect(await result.current.saveEdit()).toBe(false) })
    expect(result.current.editBuf.name).toBe('继续保留')
    expect(result.current.saving).toBe(false)
    expect(result.current.saveError).toBeTruthy()
    await act(async () => { expect(await result.current.saveEdit()).toBe(true) })
  })
  it('does not repeat a confirmed write when readback fails', async () => {
    const { result } = setup(vi.fn(async () => false))
    act(() => result.current.startEdit(row))
    await act(async () => { expect(await result.current.saveEdit()).toBe(true) })
    expect(result.current.refreshFailed).toBe(true)
    expect(result.current.editingId).toBeNull()
    expect(state.persist).toHaveBeenCalledTimes(1)
  })
  it('serializes double clicks and blocks cancellation during a write', async () => {
    let finish!: (value: unknown) => void
    state.persist.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result } = setup()
    act(() => result.current.startEdit(row))
    let first!: Promise<boolean>
    act(() => { first = result.current.saveEdit(); result.current.cancelEdit() })
    expect(result.current.editingId).toBe('row-1')
    await act(async () => { expect(await result.current.saveEdit()).toBe(false); finish({ data: [row], error: null }); await first })
    expect(state.persist).toHaveBeenCalledTimes(1)
  })
  it('keeps a failed new record and focuses its field errors without sending a query', async () => {
    const { result } = setup()
    act(() => result.current.startAdd())
    act(() => result.current.setNewRow({ name: '', amount: 'not-a-number', settings: '{' }))
    await act(async () => { expect(await result.current.saveAdd()).toBe(false) })
    expect(result.current.adding).toBe(true)
    expect(result.current.fieldErrors).toHaveProperty('name')
    expect(result.current.newRow.settings).toBe('{')
    expect(state.persist).not.toHaveBeenCalled()
  })
})
