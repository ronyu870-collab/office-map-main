'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, ChevronDown, Filter, X } from 'lucide-react';
import {
  LEASE_TABLE_FIELDS, isLeaseFilterActive,
  type LeaseColumnKey, type LeaseColumnFilter, type LeaseFilterOption, type LeaseTableSort,
} from '../leaseTableQuery';

interface LeaseColumnMenuProps {
  columnKey: LeaseColumnKey;
  filter?: LeaseColumnFilter;
  sort: LeaseTableSort;
  options: LeaseFilterOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilter: (filter: LeaseColumnFilter) => void;
  onSort: (sort: LeaseTableSort) => void;
  variant?: 'header' | 'toolbar';
}

export function LeaseColumnMenu({ columnKey, filter, sort, options, open, onOpenChange, onFilter, onSort, variant = 'header' }: LeaseColumnMenuProps) {
  const { label, type } = LEASE_TABLE_FIELDS[columnKey];
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [draft, setDraft] = React.useState<LeaseColumnFilter>({});
  const [optionSearch, setOptionSearch] = React.useState('');
  const [position, setPosition] = React.useState({ top: 0, left: 0, maxHeight: 480 });
  const dialogId = React.useId();
  const active = isLeaseFilterActive(filter);
  const sorted = sort?.key === columnKey;
  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const availableBelow = window.innerHeight - rect.bottom - 12;
      const availableAbove = rect.top - 12;
      const below = availableBelow >= 280 || availableBelow >= availableAbove;
      const maxHeight = Math.max(100, Math.min(480, below ? availableBelow : availableAbove));
      const height = Math.min(menuRef.current?.scrollHeight ?? maxHeight, maxHeight);
      setPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
        top: below ? rect.bottom + 4 : Math.max(8, rect.top - height - 4),
        maxHeight,
      });
    };
    update();
    menuRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    const outsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) close();
    };
    const scroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) update();
    };
    document.addEventListener('pointerdown', outsideClick);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', scroll, true);
    return () => {
      document.removeEventListener('pointerdown', outsideClick);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', scroll, true);
    };
  }, [open, close]);

  const numericRangeError = type === 'number' && [draft.min, draft.max].some((value) => value && (!Number.isFinite(Number(value)) || Number(value) < 0));
  const invertedRange = draft.min && draft.max && (type === 'number' ? Number(draft.min) > Number(draft.max) : draft.min > draft.max);
  const rangeError = numericRangeError ? '请输入有效的非负数' : invertedRange ? '最小值不能大于最大值' : '';
  const apply = () => {
    if (rangeError) return;
    onFilter(draft);
    close();
    triggerRef.current?.focus();
  };
  const chooseSort = (direction: 'asc' | 'desc') => {
    onSort({ key: columnKey, direction });
    close();
    triggerRef.current?.focus();
  };
  const toggleValue = (value: string) => {
    setDraft((previous) => {
      const selected = previous.values ?? options.map((option) => option.value);
      return { ...previous, values: selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value] };
    });
  };
  const filteredOptions = options.filter((option) => option.label.toLocaleLowerCase('zh-CN').includes(optionSearch.trim().toLocaleLowerCase('zh-CN')));
  const inputClass = 'w-full rounded border border-zinc-200 px-2 py-1.5 text-xs outline-none focus:border-[#003e7e]';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`${label}${variant === 'header' ? '筛选和排序' : '快捷筛选'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        title={label}
        onClick={() => {
          if (!open) { setDraft({ ...filter }); setOptionSearch(''); }
          onOpenChange(!open);
        }}
        className={`flex min-w-0 items-center gap-1 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/40 ${variant === 'toolbar' ? 'border px-2 py-1 text-xs' : 'w-full py-0.5 text-left text-xs font-semibold'} ${active || sorted ? 'border-[#003e7e] bg-blue-50 text-[#003e7e]' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-100'}`}
      >
        <span className="truncate">{label}</span>
        {sorted
          ? sort.direction === 'asc' ? <ArrowUp size={11} className="shrink-0" /> : <ArrowDown size={11} className="shrink-0" />
          : active ? <Filter size={11} className="shrink-0" /> : <ChevronDown size={11} className="shrink-0" />}
      </button>
      {open && createPortal(
        <div
          ref={menuRef}
          id={dialogId}
          role="dialog"
          aria-label={`${label}筛选菜单`}
          style={{ position: 'fixed', ...position, width: 'min(280px, calc(100vw - 16px))', zIndex: 9999 }}
          className="overflow-auto rounded-lg border border-zinc-200 bg-white p-3 text-xs font-normal text-zinc-700 shadow-xl"
          onKeyDown={(event) => {
            if (event.key === 'Escape') { event.stopPropagation(); close(); triggerRef.current?.focus(); }
            if (event.key === 'Enter' && (event.target as HTMLElement).tagName === 'INPUT' && (event.target as HTMLInputElement).type !== 'checkbox') { event.preventDefault(); apply(); }
            if (event.key === 'Tab') {
              const controls = menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select');
              const first = controls?.[0];
              const last = controls?.[controls.length - 1];
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
          }}
        >
          <div className="mb-2 flex items-center justify-between gap-2 font-semibold text-zinc-900">
            <span>{label}</span><button type="button" onClick={() => { close(); triggerRef.current?.focus(); }} aria-label="关闭筛选菜单" className="rounded p-1 hover:bg-zinc-100"><X size={13} /></button>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-1">
            <button type="button" onClick={() => chooseSort('asc')} aria-pressed={sorted && sort.direction === 'asc'} className="flex items-center gap-1 rounded border border-zinc-200 px-2 py-1.5 hover:bg-blue-50"><ArrowUp size={12} />{type === 'period' ? '从远到近' : type === 'number' || columnKey === 'year' ? '从小到大' : '升序'}</button>
            <button type="button" onClick={() => chooseSort('desc')} aria-pressed={sorted && sort.direction === 'desc'} className="flex items-center gap-1 rounded border border-zinc-200 px-2 py-1.5 hover:bg-blue-50"><ArrowDown size={12} />{type === 'period' ? '从近到远' : type === 'number' || columnKey === 'year' ? '从大到小' : '降序'}</button>
            {sorted ? <button type="button" onClick={() => { onSort(null); close(); }} className="col-span-2 py-1 text-left text-zinc-500">恢复默认顺序</button> : null}
          </div>
          {type === 'number' ? (
            <div>
              <p className="mb-1 text-zinc-400">{columnKey === 'area' ? '面积范围（㎡）' : '租金范围（元/㎡/月）'}</p>
              <div className="grid grid-cols-2 gap-2">
                <label>最小值<input type="number" min="0" step="any" aria-label={`${label}最小值`} value={draft.min ?? ''} onChange={(event) => setDraft({ ...draft, values: undefined, min: event.target.value })} className={inputClass} /></label>
                <label>最大值<input type="number" min="0" step="any" aria-label={`${label}最大值`} value={draft.max ?? ''} onChange={(event) => setDraft({ ...draft, values: undefined, max: event.target.value })} className={inputClass} /></label>
              </div>
              <label className="mt-2 flex items-center gap-2"><input type="checkbox" checked={draft.values?.includes('') ?? false} onChange={(event) => setDraft({ values: event.target.checked ? [''] : undefined })} />仅未填写</label>
            </div>
          ) : (
            <>
              {type === 'text' ? <label className="mb-2 block">包含关键词<input aria-label={`${label}包含关键词`} value={draft.search ?? ''} onChange={(event) => setDraft({ ...draft, search: event.target.value })} className={inputClass} /></label> : null}
              {type === 'period' ? <div className="mb-2 grid grid-cols-2 gap-2">{(['min', 'max'] as const).map((bound) => <label key={bound}>{bound === 'min' ? '起始季度' : '结束季度'}<select aria-label={bound === 'min' ? '起始季度' : '结束季度'} value={draft[bound] ?? ''} onChange={(event) => setDraft({ ...draft, [bound]: event.target.value })} className={inputClass}><option value="">不限</option>{options.filter((option) => option.value).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}</div> : null}
              <input type="search" aria-label={`搜索${label}选项`} placeholder="搜索选项" value={optionSearch} onChange={(event) => setOptionSearch(event.target.value)} className={inputClass} />
              <div className="my-1.5 flex gap-3 text-[#003e7e]"><button type="button" onClick={() => setDraft({ ...draft, values: undefined })}>全选</button><button type="button" onClick={() => setDraft({ ...draft, values: [] })}>取消全选</button></div>
              <div className="max-h-44 overflow-auto rounded border border-zinc-100">
                {filteredOptions.map((option) => <label key={option.value} className="flex cursor-pointer items-start gap-2 px-2 py-1.5 hover:bg-zinc-50"><input type="checkbox" checked={draft.values === undefined || draft.values.includes(option.value)} onChange={() => toggleValue(option.value)} className="mt-0.5 shrink-0" /><span className="break-all">{option.label}</span></label>)}
                {filteredOptions.length === 0 ? <p className="p-2 text-zinc-400">无匹配选项</p> : null}
              </div>
            </>
          )}
          {rangeError ? <p role="alert" className="mt-2 text-red-600">{rangeError}</p> : null}
          <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-2">
            <button type="button" onClick={() => { onFilter({}); if (sorted) onSort(null); close(); triggerRef.current?.focus(); }} className="text-zinc-500 hover:text-[#003e7e]">清除本列条件</button>
            <button type="button" onClick={apply} disabled={Boolean(rangeError)} className="rounded bg-[#003e7e] px-3 py-1.5 text-white disabled:opacity-40">应用筛选</button>
          </div>
        </div>, document.body,
      )}
    </>
  );
}
