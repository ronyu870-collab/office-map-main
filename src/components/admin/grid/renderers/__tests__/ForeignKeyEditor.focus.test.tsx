import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('ag-grid-react', () => ({ useGridCellEditor: vi.fn() }));
import { ForeignKeyEditor } from '../ForeignKeyEditor';

describe('foreign-key editor search focus', () => {
  it('preserves focus and caret while the visible foreign-key choices update', () => {
    const props = {
      value: '',
      onValueChange: vi.fn(),
      stopEditing: vi.fn(),
      colDef: {
        cellEditorParams: {
          foreignKey: 'buildings',
          options: { a: '合成甲楼', b: '合成乙楼' },
        },
      },
    } as any;
    render(<ForeignKeyEditor {...props} />);
    const input = screen.getByPlaceholderText('搜索...') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '甲' } });
    input.setSelectionRange(1, 1);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    expect(screen.getByText('合成甲楼')).toBeInTheDocument();
    expect(screen.queryByText('合成乙楼')).toBeNull();
    fireEvent.change(input, { target: { value: '乙' } });
    input.setSelectionRange(1, 1);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(1);
    expect(screen.getByText('合成乙楼')).toBeInTheDocument();
    expect(screen.queryByText('合成甲楼')).toBeNull();
  });
});
