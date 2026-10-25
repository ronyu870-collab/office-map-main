import React from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TableConfig } from '../../types'
const db = vi.hoisted(() => ({ writeError: false, writes: vi.fn(), exported: [] as any[] }))
const data = vi.hoisted(() => [{ id: 'a', name: '合成甲', amount: 10, enabled: false, building_id: 'b', updated_at: 'v1' }, { id: 'b', name: '合成乙', amount: 0, enabled: true, building_id: 'b', updated_at: 'v1' }])
vi.mock('ag-grid-react', () => ({ AgGridReact: React.forwardRef(function TestAgGrid() { return null }) }))
vi.mock('ag-grid-community', () => ({ ModuleRegistry: { registerModules: vi.fn() }, AllCommunityModule: {}, themeQuartz: { withParams: () => ({}) } }))
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: () => {
  let writing = false
  const query: any = { select: () => query, range: () => query, order: () => query, eq: () => query, update: (value: unknown) => { writing = true; db.writes(value); return query }, insert: (value: unknown) => { writing = true; db.writes(value); return query }, then: (resolve: any) => Promise.resolve(resolve({ data: writing && db.writeError ? null : data, error: writing && db.writeError ? { message: '离线，请重试' } : null })) }
  return query
} } }))
vi.mock('@/src/services/Auth', () => ({ getSession: async () => ({ user: { id: 'test-user' } }) }))
vi.mock('@/src/utils/audit', () => ({ logAction: vi.fn() }))
vi.mock('../useXlsxImport', () => ({ useXlsxImport: () => ({ uploading: false, importErrors: [], fileInputRef: { current: null }, setImportErrors: vi.fn(), downloadTemplate: vi.fn(), triggerUpload: vi.fn(), handleFileSelect: vi.fn() }) }))
vi.mock('../useExcelExport', () => ({ useExcelExport: (_config: unknown, _dicts: unknown, rows: any[]) => ({ exportToExcel: () => { db.exported = rows } }) }))
import { GridPanel } from '../GridPanel'
const config: TableConfig = { table: 'synthetic', label: '合成记录', cols: [{ key: 'id', label: 'ID', type: 'uuid', hidden: true, readOnly: true }, { key: 'name', label: '名称', type: 'text', required: true }, { key: 'amount', label: '面积', type: 'number' }, { key: 'enabled', label: '启用', type: 'boolean' }, { key: 'building_id', label: '关联项目', type: 'uuid', foreignKey: 'buildings' }] }
const dicts = { buildings: { b: '合成关联' } }
beforeEach(() => {
  sessionStorage.clear(); db.writeError = false; db.writes.mockReset(); db.exported = []
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
})
async function open() {
  render(<GridPanel config={config} dicts={dicts} />)
  await screen.findByRole('button', { name: '合成甲' })
  fireEvent.click(screen.getAllByRole('button', { name: '编辑' })[0])
  return await screen.findByRole('dialog', { name: '编辑记录' })
}
describe('mobile record controller and confirmation', () => {
  it('continues editing or explicitly discards, without mutating saved list values', async () => {
    const editor = await open()
    fireEvent.change(within(editor).getByLabelText(/名称/), { target: { value: '未保存名称' } })
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    const confirmation = await screen.findByRole('dialog', { name: '未保存的修改' })
    fireEvent.click(within(confirmation).getByRole('button', { name: '继续编辑' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '未保存的修改' })).toBeNull())
    expect(within(editor).getByLabelText(/名称/)).toHaveValue('未保存名称')
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    fireEvent.click(await screen.findByRole('button', { name: '放弃修改并继续' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑记录' })).toBeNull())
    expect(screen.getByRole('button', { name: '合成甲' })).toBeVisible()
    expect(db.writes).not.toHaveBeenCalled()
  })
  it('save-and-continue failure keeps both the intended action and input until successful retry', async () => {
    const editor = await open()
    fireEvent.change(within(editor).getByLabelText(/名称/), { target: { value: '重试保留' } })
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    db.writeError = true
    fireEvent.click(await screen.findByRole('button', { name: '保存并继续' }))
    expect(await screen.findByRole('alert', { name: '' })).toBeTruthy()
    await waitFor(() => expect(db.writes).toHaveBeenCalledTimes(1))
    expect(within(editor).getByLabelText(/名称/)).toHaveValue('重试保留')
    expect(screen.getByRole('dialog', { name: '未保存的修改' })).toBeVisible()
    db.writeError = false
    fireEvent.click(screen.getByRole('button', { name: '保存并继续' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '未保存的修改' })).toBeNull())
    expect(db.writes).toHaveBeenCalledTimes(2)
  })
  it('returning to the original value avoids an unnecessary confirmation', async () => {
    const editor = await open()
    const input = within(editor).getByLabelText(/名称/)
    fireEvent.change(input, { target: { value: '变更' } }); fireEvent.change(input, { target: { value: '合成甲' } })
    fireEvent.click(within(editor).getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '编辑记录' })).toBeNull())
    expect(screen.queryByRole('dialog', { name: '未保存的修改' })).toBeNull()
  })
  it('boolean filters and export share the same formal record scope', async () => {
    render(<GridPanel config={config} dicts={dicts} />)
    await screen.findByRole('button', { name: '合成甲' })
    fireEvent.change(screen.getByLabelText('筛选启用'), { target: { value: 'false' } })
    await waitFor(() => expect(screen.queryByRole('button', { name: '合成乙' })).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(db.exported.map(row => row.id)).toEqual(['a'])
  })
  it('native unload warns and keeps a recoverable account-scoped snapshot', async () => {
    const editor = await open()
    fireEvent.change(within(editor).getByLabelText(/名称/), { target: { value: '返回恢复' } })
    const event = new Event('beforeunload', { cancelable: true })
    act(() => window.dispatchEvent(event))
    expect(event.defaultPrevented).toBe(true)
    await waitFor(() => expect(Object.keys(sessionStorage).some(key => key.includes('test-user') && sessionStorage.getItem(key)?.includes('返回恢复'))).toBe(true))
  })
})
