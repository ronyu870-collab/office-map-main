import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const auth = vi.hoisted(() => ({ id: 'user-a' }))
vi.mock('@/src/services/Auth', () => ({ getSession: async () => ({ user: { id: auth.id } }) }))
import { GRID_DRAFT_PREFIX, useGridRecovery, type RecordDraft } from '../useGridRecovery'
const draft: RecordDraft = { kind: 'edit', original: { id: '1', name: '原值' }, values: { id: '1', name: '未保存值' } }
beforeEach(() => { sessionStorage.clear(); auth.id = 'user-a' })
describe('tab-local record recovery', () => {
  it('restores only the same authenticated user and table context', async () => {
    sessionStorage.setItem(`${GRID_DRAFT_PREFIX}user-a:table-a`, JSON.stringify(draft))
    const { result, unmount } = renderHook(() => useGridRecovery('table-a', () => null))
    await waitFor(() => expect(result.current.recovery?.values.name).toBe('未保存值'))
    unmount(); auth.id = 'user-b'
    const second = renderHook(() => useGridRecovery('table-a', () => null))
    await act(async () => { await Promise.resolve() })
    expect(second.result.current.recovery).toBeNull()
    expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-a`)).toBeTruthy()
  })
  it('does not offer a previous table draft after switching to an empty context', async () => {
    sessionStorage.setItem(`${GRID_DRAFT_PREFIX}user-a:table-a`, JSON.stringify(draft))
    const hook = renderHook(({ scope }) => useGridRecovery(scope, () => null), { initialProps: { scope: 'table-a' } })
    await waitFor(() => expect(hook.result.current.recovery).toBeTruthy())
    hook.rerender({ scope: 'table-b' })
    expect(hook.result.current.recovery).toBeNull()
    expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-a`)).toBeTruthy()
  })
  it('removes stale recovery after the user reverts to the original values', async () => {
    let current: RecordDraft = { ...draft, dirty: true }
    const { result } = renderHook(() => useGridRecovery('table-a', () => current))
    await waitFor(() => expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-a`)).toBeTruthy())
    current = { ...draft, dirty: false, values: draft.original }
    act(() => result.current.flush())
    expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-a`)).toBeNull()
  })
  it('flushes current input and clears only its scoped cache after save/discard', async () => {
    const { result } = renderHook(() => useGridRecovery('table-a', () => draft))
    await waitFor(() => expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-a`)).toBeTruthy())
    sessionStorage.setItem(`${GRID_DRAFT_PREFIX}user-a:table-b`, 'keep')
    act(() => result.current.clear())
    expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-a`)).toBeNull()
    expect(sessionStorage.getItem(`${GRID_DRAFT_PREFIX}user-a:table-b`)).toBe('keep')
  })
})
