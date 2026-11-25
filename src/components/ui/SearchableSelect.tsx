'use client';

import * as React from 'react';
import { ChevronDown, X } from 'lucide-react';
import styles from './SearchableSelect.module.css';

type Option = string | { value: string; label: string; detail?: string; keywords?: readonly string[]; aliases?: readonly string[] };

interface SearchableSelectProps {
  value: string;
  onChange: (val: string) => void;
  options: Option[];
  listPlacement?: 'overlay' | 'inline';
  matches?: (option: Exclude<Option, string>, query: string) => boolean;
  placeholder?: string;
  disabled?: boolean;
  locked?: boolean;
  onClear?: () => void;
  className?: string;
  id?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

function normalizeOptions(options: Option[]): Exclude<Option, string>[] {
  return options.map(o => typeof o === 'string' ? { value: o, label: o } : o);
}

export function SearchableSelect({
  value,
  onChange,
  options,
  matches,
  listPlacement = 'overlay',
  placeholder = '请选择',
  disabled = false,
  locked = false,
  onClear,
  className = '',
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SearchableSelectProps) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(0);
  const ref = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();
  const list = React.useRef<HTMLDivElement>(null);
  React.useLayoutEffect(() => {
    const panel = list.current;
    if (!open || listPlacement !== 'overlay' || !panel?.showPopover) return;
    panel.popover = 'manual'; panel.showPopover();
    const place = () => {
      const box = ref.current?.getBoundingClientRect();
      if (!box) return;
      const viewport = window.visualViewport;
      const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? innerWidth, height = viewport?.height ?? innerHeight;
      panel.style.position = 'fixed'; panel.style.margin = '0';
      panel.style.width = `${Math.min(box.width, width - 16)}px`;
      panel.style.left = `${Math.max(left + 8, Math.min(box.left, left + width - box.width - 8))}px`;
      const below = top + height - box.bottom - 12, above = box.top - top - 12;
      const upwards = below < Math.min(240, panel.scrollHeight) && above > below;
      panel.style.maxHeight = `${Math.max(0, Math.min(240, upwards ? above : below))}px`;
      panel.style.top = `${upwards ? box.top - panel.getBoundingClientRect().height - 4 : box.bottom + 4}px`;
      panel.dataset.placement = upwards ? 'above' : 'below';
    };
    place();
    const resize = new ResizeObserver(place);
    if (ref.current) resize.observe(ref.current);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    return () => {
      if (panel.matches(':popover-open')) panel.hidePopover();
      panel.removeAttribute('popover'); panel.removeAttribute('style');
      resize.disconnect(); window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
    };
  }, [open, listPlacement, query, options]);

  const normalized = React.useMemo(() => normalizeOptions(options), [options]);

  const filtered = query
    ? normalized.filter(o => matches ? matches(o, query) : o.label.toLowerCase().includes(query.toLowerCase()))
    : normalized;

  React.useEffect(() => {
    if (open) document.getElementById(`${listboxId}-${Math.min(activeIndex, filtered.length - 1)}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex, filtered.length, listboxId]);

  const listClass = listPlacement === 'inline' ? styles.inline : styles.overlay;
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
      if (e.key === 'Escape' && !e.isComposing && e.keyCode !== 229) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && open) {
      e.preventDefault(); e.stopPropagation(); setOpen(false); setQuery(''); return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); setOpen(true);
      setActiveIndex(index => filtered.length ? (index + (e.key === 'ArrowDown' ? 1 : -1) + filtered.length) % filtered.length : 0);
    }
    if (e.key === 'Enter' && !open) { e.preventDefault(); setOpen(true); return; }
    if (e.key === 'Enter' && open) {
      e.preventDefault();
      if (!filtered.length) return;
      onChange(filtered[Math.min(activeIndex, filtered.length - 1)].value);
      setOpen(false); setQuery('');
    }
  };

  // 锁定状态：显示选中值 + 清除按钮
  if (locked && value) {
    return (
      <div ref={ref} className={`relative ${className}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); } }}>
        <div className={styles.locked} aria-disabled={disabled || undefined}>
          <span className="flex-1 truncate">{selectedLabel || value}</span>
          {onClear && (
            <button
              type="button"
              onClick={onClear}
              disabled={disabled}
              aria-label="清除选择"
              className={styles.clear}
              title="清除选择"
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) { setOpen(false); setQuery(''); } }}>
      <input
        id={id}
        type="text"
        role="combobox"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        aria-activedescendant={open && filtered.length ? `${listboxId}-${Math.min(activeIndex, filtered.length - 1)}` : undefined}
        value={open ? query : selectedLabel}
        onChange={(e) => { setQuery(e.target.value); setActiveIndex(0); setOpen(true); }}
        onFocus={() => { if (!disabled) { setQuery(''); setActiveIndex(0); setOpen(true); } }}
        onKeyDown={handleKeyDown}
        placeholder={open ? '搜索…' : placeholder}
        disabled={disabled}
        autoComplete="off"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={styles.input}
      />
      <div className={styles.chevron} data-open={open}>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" />
      </div>
      <div ref={list} id={listboxId} role="listbox" hidden={!open} className={`${styles.list} ${listClass}`}>
          {open ? filtered.length > 0 ? <>
          {filtered.map((opt, index) => (
            <button
              type="button"
              key={opt.value}
              id={`${listboxId}-${index}`}
              onMouseDown={event => event.preventDefault()}
              tabIndex={-1}
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
                setQuery('');
              }}
              role="option"
              aria-selected={opt.value === value}
              aria-label={opt.label}
              aria-describedby={opt.detail || (query && opt.aliases?.length) ? `${listboxId}-detail-${index}` : undefined}
              data-active={index === activeIndex || undefined}
              className={styles.option}
            >
              {opt.label}
              <span id={`${listboxId}-detail-${index}`} className={styles.detail}>
                {[opt.detail, query && opt.aliases?.length ? `曾用名：${opt.aliases.join("、")}` : ""].filter(Boolean).join(" · ")}
              </span>
            </button>
          ))}</> : <div className={styles.empty} role="status">无匹配选项</div> : null}
        </div>
    </div>
  );
}
