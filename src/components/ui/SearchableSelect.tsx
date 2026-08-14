'use client';

import * as React from 'react';

type Option = string | { value: string; label: string };

interface SearchableSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  placeholder?: string;
  disabled?: boolean;
  locked?: boolean;
  onClear?: () => void;
  className?: string;
  id?: string;
}

function normalizeOptions(options: Option[]): { value: string; label: string }[] {
  return options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = '请选择',
  disabled = false,
  locked = false,
  onClear,
  className = '',
  id,
}: SearchableSelectProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();

  const normalized = React.useMemo(() => normalizeOptions(options), [options]);

  const filtered = query
    ? normalized.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : normalized;

  const selectedLabel = normalized.find(o => o.value === value)?.label ?? '';

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && filtered.length > 0) {
      e.preventDefault();
      onChange(filtered[0].value);
      setOpen(false);
      setQuery('');
    }
  };

  // 锁定状态：显示选中值 + 清除按钮
  if (locked && value) {
    return (
      <div ref={ref} className={`relative ${className}`}>
        <div className="flex min-h-10 w-full items-center rounded-lg border border-[#003e7e]/40 bg-blue-50 px-3 py-2.5 text-sm font-medium text-[#003e7e]">
          <span className="flex-1 truncate">{selectedLabel || value}</span>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              aria-label="清除选择"
              className="ml-2 text-zinc-400 hover:text-zinc-600 flex-shrink-0"
              title="清除选择"
            >
              <svg aria-hidden="true" className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <input
        id={id}
        type="text"
        role="combobox"
        value={open ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onFocus={() => { if (!disabled) { setQuery(''); setOpen(true); } }}
        onKeyDown={handleKeyDown}
        placeholder={open ? '搜索…' : placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={`
          min-h-10 w-full rounded-lg border px-3 py-2.5 text-sm
          transition-[border-color,box-shadow,background-color] duration-200
          focus:outline-none focus:ring-2 focus:ring-[#003e7e]/20 focus:border-[#003e7e]
          disabled:bg-zinc-50 disabled:text-zinc-400 disabled:cursor-not-allowed
          ${!value && !open ? 'text-zinc-400' : 'text-zinc-900'}
          border-zinc-200 bg-white hover:border-zinc-300
        `.trim()}
      />
      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
        <svg aria-hidden="true" className="h-4 w-4 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>
      {open && filtered.length > 0 && (
        <div id={listboxId} role="listbox" className="absolute z-50 mt-1 max-h-60 w-full overflow-auto overscroll-contain rounded-lg border border-zinc-200 bg-white p-1 shadow-lg">
          {filtered.map((opt) => (
            <button
              type="button"
              key={opt.value}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setQuery('');
              }}
              role="option"
              aria-selected={opt.value === value}
              className={`block w-full cursor-pointer rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 ${
                opt.value === value ? 'bg-blue-100 font-medium text-[#003e7e]' : 'text-zinc-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-zinc-200 bg-white p-3 text-center text-sm text-zinc-400 shadow-lg">
          无匹配选项
        </div>
      )}
    </div>
  );
}
