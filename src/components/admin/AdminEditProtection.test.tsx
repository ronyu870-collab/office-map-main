import React from 'react'
import Link from 'next/link'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('next/link', () => ({ default: ({ children, ...props }: any) => React.createElement('a', props, children) }))
vi.mock('next/navigation', () => ({ useRouter: () => navigation }))
import { AdminEditProtection, useAdminEditProtection } from './AdminEditProtection'
function Consumer({ first, second }: { first: () => Promise<boolean>; second: () => Promise<boolean> }) {
  const { register, requestNavigation } = useAdminEditProtection()
  React.useEffect(() => register(Symbol('first'), first), [register, first])
  React.useEffect(() => register(Symbol('second'), second), [register, second])
  return <><button onClick={() => { void requestNavigation(() => navigation.push('/admin?section=users')) }}>切栏目</button><Link href="/" onClick={event => event.preventDefault()}>回首页</Link></>
}
beforeEach(() => { history.replaceState(null, '', '/admin?section=database') })
describe('admin navigation editing boundary', () => {
  it('awaits registered sessions in order and stops when one stays editing', async () => {
    navigation.push.mockReset()
    const first = vi.fn(async () => false); const second = vi.fn(async () => true)
    render(<AdminEditProtection><Consumer first={first} second={second} /></AdminEditProtection>)
    fireEvent.click(screen.getByText('切栏目'))
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    expect(second).not.toHaveBeenCalled(); expect(navigation.push).not.toHaveBeenCalled()
    first.mockResolvedValue(true)
    fireEvent.click(screen.getByText('切栏目'))
    await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/admin?section=users'))
  })
  it('protects normal same-window links, preserving modifier/new-tab behavior', async () => {
    navigation.push.mockReset()
    const first = vi.fn(async () => false); const second = vi.fn(async () => true)
    render(<AdminEditProtection><Consumer first={first} second={second} /></AdminEditProtection>)
    fireEvent.click(screen.getByText('回首页'))
    await waitFor(() => expect(first).toHaveBeenCalledTimes(1))
    expect(navigation.push).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('回首页'), { ctrlKey: true })
    expect(first).toHaveBeenCalledTimes(1)
  })
})
