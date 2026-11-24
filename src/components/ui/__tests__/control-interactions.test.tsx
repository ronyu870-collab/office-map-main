import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { SearchableSelect } from '../SearchableSelect';

describe('shared control interaction protection', () => {
  it('prevents submitting again while busy and retains the action content', () => {
    const submit = vi.fn();
    const { rerender } = render(<Button onClick={submit}>导出数据</Button>);
    fireEvent.click(screen.getByRole('button', { name: '导出数据' }));
    expect(submit).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={submit} loading loadingLabel="导出中…">导出数据</Button>);
    const button = screen.getByRole('button', { name: '导出中…' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('导出数据')).toBeInTheDocument();
    fireEvent.click(button);
    expect(submit).toHaveBeenCalledTimes(1);
    rerender(<Button onClick={submit}>导出数据</Button>);
    expect(screen.getByRole('button', { name: '导出数据' })).toBeEnabled();
  });
  it('does not clear a disabled locked selection', () => {
    const clear = vi.fn();
    render(<SearchableSelect value="a" options={[{ value: 'a', label: '楼宇 A' }]} onChange={vi.fn()} locked disabled onClear={clear} />);
    fireEvent.click(screen.getByRole('button', { name: '清除选择' }));
    expect(clear).not.toHaveBeenCalled();
  });
  it('keeps composition in the input and permits keyboard selection and Tab exit', () => {
    const change = vi.fn();
    render(<><SearchableSelect value="" options={['北京', '上海']} onChange={change} /><button>下一项</button></>);
    const input = screen.getByRole('combobox');
    act(() => input.focus());
    fireEvent.change(input, { target: { value: '北京' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(change).not.toHaveBeenCalled();
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(change).toHaveBeenCalledWith('北京');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeVisible();
    act(() => screen.getByRole('button', { name: '下一项' }).focus());
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('option')).toBeNull();
  });
});
