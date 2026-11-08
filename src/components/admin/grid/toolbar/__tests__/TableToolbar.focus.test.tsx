import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { TableConfig } from '../../../types';
import { TableToolbar } from '../TableToolbar';

const config: TableConfig = { table: 'synthetic', label: '合成记录', cols: [] };

describe('admin grid toolbar search', () => {
  it('retains search focus and caret when the parent updates the visible record count', () => {
    function Harness() {
      const [search, setSearch] = React.useState('');
      const count = search === '甲' ? 1 : search === '乙' ? 0 : 2;
      return <>
        <TableToolbar
          config={config}
          search={search}
          onSearchChange={setSearch}
          totalRows={2}
          filteredRows={count}
          showInactive={false}
          onToggleInactive={vi.fn()}
          statsEnabled={false}
          onToggleStats={vi.fn()}
          viewMode=""
          onViewModeChange={vi.fn()}
          onRefresh={vi.fn()}
          onExport={vi.fn()}
          onDownloadTemplate={vi.fn()}
          onTriggerUpload={vi.fn()}
          onAdd={vi.fn()}
          onOpenDiag={vi.fn()}
          onOpenUploadGuide={vi.fn()}
          uploading={false}
        />
      </>;
    }
    render(<Harness />);
    const input = screen.getByPlaceholderText('搜索') as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '甲' } });
    input.setSelectionRange(1, 1);
    expect(screen.getByText('1 / 2 条')).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    fireEvent.change(input, { target: { value: '乙' } });
    input.setSelectionRange(1, 1);
    expect(screen.getByText('0 / 2 条')).toBeInTheDocument();
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
  });
});
