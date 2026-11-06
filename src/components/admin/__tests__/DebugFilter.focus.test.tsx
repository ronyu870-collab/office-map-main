import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { DebugFilter } from '@/src/components/admin/DebugFilter';

const PROJECTS = ['Alpha 东楼', 'Alpha 西楼', 'Alps 楼'];

function FilterResults() {
  const [query, setQuery] = React.useState('');
  const onFilterChange = (state: SidebarFilterState) => {
    setQuery(String(state.numericFilters.find(filter => filter.field === 'owner')?.value ?? ''));
  };
  return (
    <>
      <DebugFilter districts={['海淀区']} submarkets={['其他']} leeds={['NULL']} onFilterChange={onFilterChange} />
      <ul aria-label="结果">
        {PROJECTS.filter(project => project.includes(query)).map(project => <li key={project}>{project}</li>)}
      </ul>
    </>
  );
}

describe('DebugFilter', () => {
  it('retains the text filter focus and caret after matching rows refresh', () => {
    render(<FilterResults />);
    fireEvent.click(screen.getByText('多重筛选'));
    fireEvent.click(screen.getByRole('button', { name: /添加筛选条件/ }));
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'owner' } });
    const input = screen.getByPlaceholderText('模糊搜索') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: 'A' } });
    expect(screen.getByPlaceholderText('模糊搜索')).toBe(input);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'Alpa' } });
    expect(screen.queryByText('Alpha 东楼')).not.toBeInTheDocument();
    expect(input).toHaveFocus();

    input.setSelectionRange(3, 3);
    fireEvent.change(input, { target: { value: 'Alpha', selectionStart: 4, selectionEnd: 4 } });
    expect(input).toHaveFocus();
    expect(input).toHaveValue('Alpha');
    expect(input.selectionStart).toBe(4);
    expect(screen.getByText('Alpha 东楼')).toBeInTheDocument();
    expect(screen.queryByText('Alps 楼')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    expect(input).toHaveFocus();
    expect(screen.getByText('Alps 楼')).toBeInTheDocument();
  });
});
