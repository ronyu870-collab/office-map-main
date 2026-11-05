import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ push: vi.fn(), fetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: state.push }), useSearchParams: () => new URLSearchParams('buildingId=target&name=Target') }));
vi.mock('@/src/services/mapDataClient', () => ({ fetchComparePayload: () => state.fetch() }));
vi.mock('@/src/components/ErrorBoundary/PageErrorBoundary', () => ({ PageErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
import BuildingCompareWorkspace from '../BuildingCompareWorkspace';

beforeEach(() => {
  vi.clearAllMocks();
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
});
