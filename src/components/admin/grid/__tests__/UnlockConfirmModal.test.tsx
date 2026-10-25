import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/src/services/supabaseClient', () => ({ supabase: { rpc } }))
import { UnlockConfirmModal } from '../modals/UnlockConfirmModal'
beforeEach(() => rpc.mockReset())
describe('unlock confirmation', () => {
  it('retains confirmation after network failure and allows retry', async () => {
    const confirmed = vi.fn()
    rpc.mockRejectedValueOnce(new Error('网络失败')).mockResolvedValueOnce({ error: null })
    render(<UnlockConfirmModal row={{ id: 'synthetic', record_year: 2026, record_quarter: 3 }} onConfirm={confirmed} onCancel={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('解锁确认文字'), { target: { value: '我确认修改数据' } })
    fireEvent.click(screen.getByRole('button', { name: '确认解锁并编辑' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('网络失败')
    expect(confirmed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认解锁并编辑' }))
    await waitFor(() => expect(confirmed).toHaveBeenCalledTimes(1))
    expect(rpc).toHaveBeenCalledWith('unlock_row', { p_id: 'synthetic' })
  })
})
