import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RecordFields } from '../RecordFields'
import type { TableConfig } from '../../types'
const config: TableConfig = { table: 'synthetic', label: '测试', cols: [
  { key: 'building', label: '楼宇', type: 'uuid', foreignKey: 'buildings', required: true },
  { key: 'timestamp', label: '业务时间', type: 'date' },
  { key: 'secret', label: '受控字段', type: 'text', masked: true },
  { key: 'readonly', label: '来源', type: 'text', readOnly: true },
] }
describe('shared record fields', () => {
  it('preserves the editable text field focus and caret while the parent rerenders after input', () => {
    function Harness() {
      const [values, setValues] = React.useState({ name: '' });
      const columns: TableConfig = {
        table: 'synthetic', label: '合成记录',
        cols: [{ key: 'name', label: '名称', type: 'text' }],
      };
      return <RecordFields config={columns} values={values} onChange={setValues} dicts={{}} />;
    }
    render(<Harness />);
    const input = screen.getByRole('textbox', { name: '名称' }) as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: '合成甲' } });
    input.setSelectionRange(2, 2);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(2);
    expect(input).toHaveValue('合成甲');
    fireEvent.change(input, { target: { value: '合成甲乙' } });
    input.setSelectionRange(3, 3);
    expect(input).toHaveFocus();
    expect(input.selectionStart).toBe(3);
    expect(input).toHaveValue('合成甲乙');
  });
  it('edits former names one per line, preserving punctuation inside a single project name', () => {
    const change = vi.fn()
    const tags: TableConfig = { table: 'buildings', label: '楼宇', cols: [{ key: 'former_names', label: '曾用名', type: 'tags' }] }
    render(<RecordFields config={tags} values={{ former_names: ['旧项目（东座, 西座）', '另一旧名'] }} onChange={change} dicts={{}} />)
    const input = screen.getByLabelText('曾用名')
    expect(input.tagName).toBe('TEXTAREA')
    expect(input).toHaveValue('旧项目（东座, 西座）\n另一旧名')
    fireEvent.change(input, { target: { value: '旧项目（东座, 西座）\n手工补充名' } })
    expect(change).toHaveBeenCalledWith({ former_names: '旧项目（东座, 西座）\n手工补充名' })
  })
  it('supports keyboard object selection and Escape closes its menu without closing the parent task', () => {
    const change = vi.fn(); const escape = vi.fn()
    render(<div onKeyDown={escape}><RecordFields config={config} values={{ building: 'b' }} onChange={change} dicts={{ buildings: { a: '甲', b: '乙' } }} /></div>)
    const input = screen.getByRole('combobox', { name: '楼宇' })
    fireEvent.focus(input); fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' })
    expect(change).toHaveBeenCalledWith({ building: 'b' })
    fireEvent.focus(input); escape.mockClear(); fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveAttribute('aria-expanded', 'false'); expect(escape).not.toHaveBeenCalled()
  })
  it('preserves timestamp precision and masked/readonly fields while associating field errors', () => {
    render(<RecordFields config={config} values={{ building: '', timestamp: '2026-10-25T15:00:00.123456+08:00', secret: 'hidden raw', readonly: '原件' }} onChange={vi.fn()} dicts={{}} isDemo errors={{ building: '请选择楼宇' }} />)
    expect(screen.getByLabelText('业务时间')).toHaveValue('2026-10-25T15:00:00.123456+08:00')
    expect(screen.getByRole('combobox')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('combobox')).toHaveAccessibleDescription('请选择楼宇')
    expect(screen.queryByText('hidden raw')).toBeNull()
    expect(screen.getByText('原件')).toBeVisible()
  })
})
