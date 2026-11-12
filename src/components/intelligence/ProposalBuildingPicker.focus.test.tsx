// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ProposalBuildingPicker } from './ProposalBuildingPicker';
import type { ProposalDraftScope } from '@/src/lib/intelligence/proposalDraft';

const add = vi.hoisted(() => vi.fn(() => ({ status: 'added' })));
vi.mock('@/src/lib/intelligence/proposalDraft', () => ({ addProposalCandidate: add }));
vi.mock('@/src/hooks/useBuildings', () => ({
  useBuildings: () => ({ buildings: [
    { id: 'east', name: '示范中心东座', former_names: ['合成写字楼东座'], submarket: 'CBD' },
    { id: 'west', name: '示范中心西座', former_names: ['合成写字楼西座'], submarket: 'CBD' },
  ] }),
}));
it('keeps the alias picker editable across matches and confirms the selected tower ID', async () => {
  const close = vi.fn();
  render(<ProposalBuildingPicker scope={'fixture' as ProposalDraftScope} onClose={close} />);
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByRole('combobox') as HTMLInputElement;
  act(() => input.focus());
  fireEvent.change(input, { target: { value: '合' } });
  expect(within(dialog).getAllByRole('option')).toHaveLength(2);
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '合写字楼东' } });
  input.setSelectionRange(1, 1);
  fireEvent.change(input, { target: { value: '合成写字楼东', selectionStart: 2, selectionEnd: 2 } });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229, isComposing: true });
  expect(input).toHaveFocus();
  expect(input.value).toBe('合成写字楼东');
  expect(add).not.toHaveBeenCalled();
  const option = within(dialog).getByRole('option', { name: '示范中心东座' });
  expect(option).toHaveAccessibleDescription('CBD · 曾用名：合成写字楼东座');
  fireEvent.click(option);
  expect(add).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: '添加到方案' }));
  expect(add).toHaveBeenCalledWith('fixture', 'east', '示范中心东座');
  expect(close).toHaveBeenCalled();
});
