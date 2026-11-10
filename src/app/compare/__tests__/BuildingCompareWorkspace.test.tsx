import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn(), search: '', token: '' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), useSearchParams: () => new URLSearchParams(state.search) }));
vi.mock('@/src/services/mapDataClient', () => ({ fetchComparePayload: () => state.fetch() }));
vi.mock('@/src/components/SessionProvider', () => ({ useAppSession: () => state.token
  ? { status: 'authenticated', session: { user: { id: 'viewer' }, role: 'viewer', session: { access_token: state.token } } }
  : { status: 'unauthenticated', session: null } }));
vi.mock('@/src/components/ErrorBoundary/PageErrorBoundary', () => ({ PageErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
import { invalidateCompareSnapshot } from '@/src/services/compareSnapshot';
import BuildingCompareWorkspace from '../BuildingCompareWorkspace';

beforeEach(() => {
  vi.clearAllMocks();
  state.search = 'buildingId=target&name=Target';
  state.token = 'synthetic-viewer-token';
  state.fetch.mockResolvedValue({ buildings: [{ id: 'target', name: 'Target', grade: 'A', submarket: 'CBD' }, ...Array.from({ length: 7 }, (_, i) => ({ id: `b${i}`, name: `Candidate ${i}`, grade: 'A', submarket: 'CBD' }))], metrics: [], brochures: [] });
});
afterEach(cleanup);

describe('building comparison mobile selection', () => {
  it('continues typing in comparison search while results change and retains the caret', async () => {
    render(<BuildingCompareWorkspace />);
    const toggle = screen.getByRole('button', { name: /选择项目与筛选/ });
    await waitFor(() => expect(toggle).toHaveTextContent('3 个竞品'));
    fireEvent.click(toggle);
    const panel = within(document.getElementById(toggle.getAttribute('aria-controls')!)!);
    const input = panel.getByRole('textbox', { name: '搜索对比项目' }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'C' } });
    expect(panel.queryByRole('button', { name: /Target/ })).not.toBeInTheDocument();
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Canddate 6' } });
    expect(panel.getByText('没有匹配项目')).toBeInTheDocument();
    expect(panel.getByRole('textbox', { name: '搜索对比项目' })).toBe(input);
    expect(input).toHaveFocus();
    input.setSelectionRange(4, 4);
    fireEvent.change(input, { target: { value: 'Candidate 6', selectionStart: 5, selectionEnd: 5 } });
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(5);
    expect(panel.getByRole('button', { name: /Candidate 6/ })).toBeInTheDocument();
    expect(panel.queryByRole('button', { name: /Candidate 0/ })).not.toBeInTheDocument();
  });


  it('opens the same selection state, filters candidates and restores focus when returning to results', async () => {
    render(<BuildingCompareWorkspace />);
    const toggle = screen.getByRole('button', { name: /选择项目与筛选/ });
    await waitFor(() => expect(toggle).toHaveTextContent('3 个竞品'));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(screen.getByRole('textbox', { name: '搜索对比项目' }), { target: { value: 'Candidate 6' } });
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(panel).queryByRole('button', { name: /Candidate 0/ })).not.toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: /Candidate 6/ }));
    fireEvent.click(screen.getByRole('button', { name: '查看对比结果' }));
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('4 个竞品');
    expect(toggle).toHaveFocus();
    expect(within(screen.getByRole('main')).getByRole('columnheader', { name: /Candidate 6/ })).toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });
  it('preserves the target and five-competitor limit, and provides a keyboard-operable group toggle', async () => {
    render(<BuildingCompareWorkspace />);
    await screen.findByRole('button', { name: /Candidate 6/ });
    for (const i of [3, 4, 5, 6]) fireEvent.click(screen.getByRole('button', { name: new RegExp(`Candidate ${i}`) }));
    expect(screen.getByText('已选 5 / 5 个竞品')).toBeInTheDocument();
    const results = within(screen.getByRole('main'));
    expect(results.getAllByRole('columnheader')).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: /Target.*当前/ }));
    expect(results.getByRole('columnheader', { name: /Target/ })).toBeInTheDocument();
    const collapse = results.getByRole('button', { name: '收起项目定位' });
    fireEvent.click(collapse);
    expect(results.getByRole('button', { name: '展开项目定位' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('changes the comparison target without requesting the same dataset again or hiding the table', async () => {
    const { rerender } = render(<BuildingCompareWorkspace />);
    const results = within(screen.getByRole('main'));
    await results.findByRole('columnheader', { name: /Target/ });
    for (const i of [3, 4]) fireEvent.click(screen.getByRole('button', { name: new RegExp(`Candidate ${i}`) }));
    state.search = 'buildingId=b6&name=Candidate+6';
    rerender(<BuildingCompareWorkspace />);
    expect(results.getByRole('columnheader', { name: /Candidate 6/ })).toBeInTheDocument();
    expect(results.getByRole('columnheader', { name: /Candidate 4/ })).toBeInTheDocument();
    expect(screen.getByText('已选 5 / 5 个竞品')).toBeInTheDocument();
    expect(state.fetch).toHaveBeenCalledTimes(1);
  });

  it('labels the old read while refreshing and removes it immediately when the authenticated scope changes', async () => {
    const { rerender } = render(<BuildingCompareWorkspace />);
    await screen.findByRole('columnheader', { name: /Target/ });
    let finishOld!: (value: unknown) => void;
    state.fetch.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    act(() => invalidateCompareSnapshot());
    expect(screen.getByRole('status')).toHaveTextContent('当前显示上次结果');
    state.fetch.mockResolvedValueOnce({ buildings: [{ id: 'target', name: 'Other account result' }], brochures: [] });
    state.token = 'another-synthetic-viewer-token';
    rerender(<BuildingCompareWorkspace />);
    expect(screen.queryByRole('columnheader', { name: /^Target/ })).not.toBeInTheDocument();
    await screen.findByRole('columnheader', { name: /Other account result/ });
    await act(async () => finishOld({ buildings: [{ id: 'target', name: 'Old request' }], brochures: [] }));
    expect(screen.queryByRole('columnheader', { name: /Old request/ })).not.toBeInTheDocument();
    state.token = '';
    rerender(<BuildingCompareWorkspace />);
    expect(screen.queryByRole('columnheader', { name: /Other account result/ })).not.toBeInTheDocument();
  });
});
