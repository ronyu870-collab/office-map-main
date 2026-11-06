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
