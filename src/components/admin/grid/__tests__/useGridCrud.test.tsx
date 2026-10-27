import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableConfig } from '../../types'
const state = vi.hoisted(() => ({ persist: vi.fn(), traces: [] as unknown[][] }))
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: (table: string) => {
  const query: any = { insert: (data: any) => { state.traces.push(['insert', table, data]); return query }, update: (data: any) => { state.traces.push(['update', table, data]); return query }, eq: (key: string, value: any) => { state.traces.push(['eq', key, value]); return query }, select: () => state.persist() }
  return query
}, rpc: (name: string, args: unknown) => { state.traces.push(['rpc', name, args]); return state.persist() } } }))
vi.mock('@/src/services/Auth', () => ({ getSession: async () => ({ user: { id: 'synthetic-user' } }) }))
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }))
import { useGridCrud } from '../useGridCrud'
import { clearMapReadCache, readMapDataWithCache } from '@/src/services/mapReadCache'
const config: TableConfig = { table: 'synthetic', label: '测试', cols: [{ key: 'name', label: '名称', type: 'text', required: true }, { key: 'amount', label: '面积', type: 'number' }, { key: 'settings', label: '配置', type: 'jsonb' }] }
const row = { id: 'row-1', name: '原值', amount: 10, settings: { enabled: true }, updated_at: 'version-1' }
function setup(refresh = vi.fn(async () => true), tableConfig: TableConfig = config, original = row) {
  const toast = vi.fn()
  const hook = renderHook(() => useGridCrud(tableConfig, {}, [original], refresh, toast))
  return { ...hook, refresh, toast }
}
beforeEach(() => { state.traces = []; state.persist.mockReset(); state.persist.mockResolvedValue({ data: [row], error: null }) })
describe('shared grid write session', () => {
  it('refuses a mixed rename and other-field edit without sending or losing either input', async () => {
    const { result } = setup(vi.fn(async () => true), { ...config, table: 'buildings' })
    act(() => result.current.startEdit(row))
    act(() => result.current.setEditBuf({ ...row, name: '新名', amount: 11 }))
    await act(async () => { expect(await result.current.saveEdit()).toBe(false) })
    expect(state.persist).not.toHaveBeenCalled()
    expect(result.current.editBuf).toMatchObject({ name: '新名', amount: 11 })
    expect(result.current.saveError).toContain('单独保存')
  })
  it('edits a building by its stable ID and original identity even when import keys are names', async () => {
    clearMapReadCache()
    const readMap = vi.fn(async () => ({}))
    await readMapDataWithCache('synthetic', '/map', readMap)
    const original = { ...row, former_names: ['更早名称'] }
    const buildingConfig: TableConfig = { ...config, table: 'buildings', uploadMatchKeys: ['name'], cols: [...config.cols, { key: 'former_names', label: '曾用名', type: 'tags' }] }
    const { result } = setup(vi.fn(async () => true), buildingConfig, original)
    act(() => result.current.startEdit(original))
    act(() => result.current.setEditBuf({ ...original, name: '新楼宇名' }))
    state.persist.mockResolvedValueOnce({ data: [{ ...original, name: '新楼宇名', former_names: ['原值', '更早名称'] }], error: null })
    await act(async () => { expect(await result.current.saveEdit()).toBe(true) })
    expect(state.traces).toContainEqual(['rpc', 'admin_rename_building', { p_id: 'row-1', p_expected_name: '原值', p_expected_former_names: ['更早名称'], p_new_name: '新楼宇名', p_former_names: null }])
    expect(state.traces.some(trace => trace[0] === 'update')).toBe(false)
    expect(state.persist).toHaveBeenCalledTimes(1)
    await readMapDataWithCache('synthetic', '/map', readMap)
    expect(readMap).toHaveBeenCalledTimes(2)
  })
  it('persists multiline former names as a list without splitting commas inside names', async () => {
    const buildingConfig: TableConfig = { ...config, table: 'buildings', cols: [...config.cols, { key: 'former_names', label: '曾用名', type: 'tags' }] }
    const { result } = setup(vi.fn(async () => true), buildingConfig)
    act(() => result.current.startEdit(row))
    act(() => result.current.setEditBuf({ ...row, former_names: '旧名（东座, 西座）\n  旧名（东座, 西座） \n补充名' }))
    await act(async () => { expect(await result.current.saveEdit()).toBe(true) })
    expect(state.traces).toContainEqual(['rpc', 'admin_rename_building', { p_id: row.id, p_expected_name: row.name, p_expected_former_names: null, p_new_name: row.name, p_former_names: ['旧名（东座, 西座）', '补充名'] }])
  })
  it('keeps the proposed building name and editing state when the database refuses an identity conflict', async () => {
    const buildingConfig: TableConfig = { ...config, table: 'buildings', uploadMatchKeys: ['name'] }
    const { result } = setup(vi.fn(async () => true), buildingConfig)
    act(() => result.current.startEdit(row))
    act(() => result.current.setEditBuf({ ...row, name: '有冲突的名称' }))
    state.persist.mockResolvedValueOnce({ data: null, error: { code: '23505', message: '名称已属于其他楼宇，已取消保存' } })
    await act(async () => { expect(await result.current.saveEdit()).toBe(false) })
    expect(result.current.editBuf.name).toBe('有冲突的名称')
    expect(result.current.editingId).toBe('row-1')
    expect(result.current.saveError).toContain('名称已属于其他楼宇')
  })
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
