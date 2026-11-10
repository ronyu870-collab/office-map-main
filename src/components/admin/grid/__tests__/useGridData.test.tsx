import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { TableConfig } from '../../types'
const db = vi.hoisted(() => ({ read: vi.fn(), selects: [] as string[], orders: [] as string[] }))
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { from: () => {
  const query: any = { select: (columns: string) => { db.selects.push(columns); return query }, range: () => query, order: (column: string) => { db.orders.push(column); return query }, eq: () => query, then: (resolve: any, reject: any) => db.read().then(resolve, reject) }; return query
} } }))
import { useGridData } from '../useGridData'
import { getGridReadPlan } from '../gridReadPlan'
const config: TableConfig = { table: 'synthetic', label: '合成数据', cols: [] }
const dicts = {}; const toast = vi.fn()
describe('complete grid reads', () => {
  it('keeps the last complete result on partial-page failure and reports refresh failure', async () => {
    db.read.mockResolvedValueOnce({ data: [{ id: 'known' }], error: null })
    const { result } = renderHook(() => useGridData(config, dicts, toast))
    await waitFor(() => expect(result.current.loading).toBe(false))
    db.read.mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }).mockResolvedValueOnce({ data: null, error: { message: '第二页失败' } })
    await act(async () => { expect(await result.current.fetchRows()).toBe(false) })
    expect(result.current.rows).toEqual([{ id: 'known' }])
    expect(result.current.loadError).toBe('第二页失败')
  })
  it('displays the first page while later pages load, then exposes the full result', async () => {
    let finishSecond!: (value: unknown) => void
    db.read.mockReset()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null })
      .mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve }))
    const hook = renderHook(() => useGridData(config, dicts, toast))
    await waitFor(() => {
      expect(hook.result.current.loading).toBe(false)
      expect(hook.result.current.loadingMore).toBe(true)
      expect(hook.result.current.rows).toHaveLength(1000)
    })
    await act(async () => { finishSecond({ data: [{ id: 1000 }], error: null }) })
    expect(hook.result.current.loadingMore).toBe(false)
    expect(hook.result.current.rows).toHaveLength(1001)
    expect(hook.result.current.rows[1000].id).toBe(1000)
    hook.unmount()
  })

  it('uses audited projections and deterministic secondary ordering on their original tables', async () => {
    db.read.mockReset().mockResolvedValue({ data: [{ id: 'known' }], error: null });
    db.selects.length = 0; db.orders.length = 0;
    const projected: TableConfig = {
      ...config, table: 'building_metrics', orderBy: 'record_year',
    };
    const hook = renderHook(() => useGridData(projected, dicts, toast));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(db.selects).toEqual([getGridReadPlan('building_metrics')?.columns]);
    expect(db.orders).toEqual(['record_year', 'id']);
    hook.unmount();
  });
  it('does not project source-table columns onto a distinct view', async () => {
    db.read.mockReset().mockResolvedValue({ data: [{ id: 'known' }], error: null });
    db.selects.length = 0;
    const viewed: TableConfig = {
      ...config, table: 'building_metrics', viewMode: { enabled: true, views: [{ key: 'latest', label: 'Latest', table: 'synthetic_view' }] },
    };
    const hook = renderHook(() => useGridData(viewed, dicts, toast));
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(db.selects).toEqual(['*']);
    hook.unmount();
  });
  it('rejects stale responses after switching data context', async () => {
    let first!: (value: unknown) => void
    db.read.mockReset().mockImplementationOnce(() => new Promise(resolve => { first = resolve })).mockResolvedValueOnce({ data: [{ id: 'new' }], error: null })
    const second = { ...config, table: 'second' }
    const hook = renderHook(({ current }) => useGridData(current, dicts, toast), { initialProps: { current: config } })
    hook.rerender({ current: second })
    await waitFor(() => expect(hook.result.current.rows).toEqual([{ id: 'new' }]))
    await act(async () => { first({ data: [{ id: 'old' }], error: null }) })
    expect(hook.result.current.rows).toEqual([{ id: 'new' }])
  })
})
