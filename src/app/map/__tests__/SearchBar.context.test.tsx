import * as React from 'react';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {SearchBar} from '@/src/components/SearchBar';
afterEach(()=>{cleanup();vi.clearAllTimers();vi.useRealTimers()});
describe('retained search workspace boundaries',()=>{
 it('keeps existing callers without a context key backward compatible',()=>{
  vi.useFakeTimers();const onSearch=vi.fn();render(<SearchBar onSearch={onSearch}/>);
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'ordinary'}});
  act(()=>vi.advanceTimersByTime(300));expect(onSearch).toHaveBeenCalledWith('ordinary');
 });
 it('rejects a request captured in an earlier view generation',()=>{
  vi.useFakeTimers();const onSearch=vi.fn();const {rerender}=render(<SearchBar value="" onSearch={onSearch} searchContextKey="list:1"/>);
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'A'}});
  rerender(<SearchBar value="A" onSearch={onSearch} searchContextKey="list:1"/>);
  rerender(<SearchBar value="A" onSearch={onSearch} searchContextKey="map:2"/>);
  rerender(<SearchBar value="A" onSearch={onSearch} searchContextKey="list:3"/>);
  act(()=>vi.advanceTimersByTime(300));expect(onSearch).not.toHaveBeenCalled();
 });
 it('rejects a pending value after an external clear in the same view',()=>{
  vi.useFakeTimers();const onSearch=vi.fn();const {rerender}=render(<SearchBar value="" onSearch={onSearch} searchContextKey="list:1"/>);
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'A'}});
  rerender(<SearchBar value="A" onSearch={onSearch} searchContextKey="list:1"/>);
  rerender(<SearchBar value="" onSearch={onSearch} searchContextKey="list:1"/>);
  act(()=>vi.advanceTimersByTime(300));expect(onSearch).not.toHaveBeenCalled();
 });
});


describe('optional keyboard navigation in search candidates', () => {
 it('clears immediately, cancels an older debounce and returns focus without a locate submission', () => {
  vi.useFakeTimers(); const onSearch = vi.fn(), onSubmit = vi.fn();
  function Search() { const [value, setValue] = React.useState(''); return <SearchBar value={value} onChange={setValue} searchContextKey="map:1" clearLabel="清空地图搜索" onSearch={onSearch} onSubmit={onSubmit}/>; }
  render(<Search/>);
  const field = screen.getByRole('searchbox');
  fireEvent.change(field, { target: { value: '望京 ABC' } });
  fireEvent.click(screen.getByRole('button', { name: '清空地图搜索' }));
  expect(field).toHaveValue(''); expect(field).toHaveFocus();
  act(() => vi.advanceTimersByTime(300));
  expect(onSearch).toHaveBeenCalledExactlyOnceWith(''); expect(onSubmit).not.toHaveBeenCalled();
 });
 it('enters a result group with ArrowDown without triggering a search or disturbing Enter submit', () => {
  const onSearch = vi.fn(), onArrowDown = vi.fn(), onSubmit = vi.fn();
  render(<SearchBar value="CBD" onSearch={onSearch} onArrowDown={onArrowDown} onSubmit={onSubmit}/>);
  const field = screen.getByRole('searchbox');
  field.focus();
  fireEvent.keyDown(field, { key: 'ArrowDown' });
  expect(onArrowDown).toHaveBeenCalledTimes(1);
  expect(onSearch).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: 'Enter' });
  expect(onSubmit).toHaveBeenCalledWith('CBD');
 });
});
