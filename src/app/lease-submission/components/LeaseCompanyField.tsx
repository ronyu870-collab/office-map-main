'use client';

import * as React from 'react';
import { useController, type Control } from 'react-hook-form';
import { ChevronDown, History } from 'lucide-react';

import { readRecentCompanyDeals, scheduleLeaseCompanyAssessment, searchLeaseCompanies } from '@/src/services/leaseCompanyLookupClient';
import { formatLeaseRent } from '@/src/utils/formatLeaseRent';
import {
  LEASE_COMPANY_NAME_MAX_LENGTH,
  LEASE_COMPANY_RECENT_LIMIT,
  type LeaseCompanyDeal,
  type LeaseCompanyLookupResult,
} from '../leaseCompanyLookup';
import type { LeaseTransactionFormData } from '../schemas/leaseTransactionSchema';

const linkClass = 'inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm text-[var(--cd-color-brand)] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] sm:pointer-fine:min-h-9';

type Lookup = { query: string; result: LeaseCompanyLookupResult | null };

function formatPeriod(deal: LeaseCompanyDeal) {
  return deal.transaction_date || [deal.transaction_year, deal.transaction_quarter].filter(Boolean).join(' ') || '时间未填';
}

function RecentDeals({ company, id }: { company: string; id: string }) {
  const [attempt, retry] = React.useReducer((value: number) => value + 1, 0);
  const [result, setResult] = React.useState<{ attempt: number; records: LeaseCompanyDeal[] | null }>();
  React.useEffect(() => {
    const controller = new AbortController();
    readRecentCompanyDeals(company, controller.signal).then(
      ({ records }) => { if (!controller.signal.aborted) setResult({ attempt, records }); },
      () => { if (!controller.signal.aborted) setResult({ attempt, records: null }); },
    );
    return () => controller.abort();
  }, [company, attempt]);
  const records = result?.attempt === attempt ? result.records : undefined;

  return (
    <section id={id} aria-label="近期成交" className="rounded-md border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-3 py-2 text-sm text-[var(--cd-color-text-primary)]">
      <p className="break-words font-medium">{company} · 近期成交</p>
      {records === undefined ? <p role="status" className="py-2">正在读取成交…</p> : records === null ? (
        <div><p role="status" className="pt-2">暂时无法读取成交。</p><button type="button" className={linkClass} onClick={retry}>重试</button></div>
      ) : records.length === 0 ? <p role="status" className="py-2">暂无可查看的成交。</p> : (
        <>
          <p className="mt-1 text-[var(--cd-color-text-secondary)]">按成交时间从新到旧，最多 {LEASE_COMPANY_RECENT_LIMIT} 笔</p>
          <ul className="mt-2 divide-y divide-[var(--cd-color-border)] border-t border-[var(--cd-color-border)]">
            {records.map((deal) => (
              <li key={deal.read_id} className="break-words py-2">
                <p className="font-medium">{deal.new_building?.trim() || '楼宇未填'}</p>
                <p className="text-[var(--cd-color-text-secondary)]">
                  {[formatPeriod(deal), deal.demand_type, deal.record_source === 'history' ? '归档历史' : '系统成交'].filter(Boolean).join(' · ')}
                </p>
                <p className="text-[var(--cd-color-text-secondary)]">
                  面积 {deal.area_sqm == null ? '—' : `${deal.area_sqm.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ㎡`}
                  {' · '}有效租金 {deal.effective_rent == null ? '—' : `${formatLeaseRent(deal.effective_rent)} 元/㎡/月`}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Free text is the form value. Suggestions never replace it until explicitly selected. */
export function LeaseCompanyField({ control, enabled }: {
  control: Control<LeaseTransactionFormData>;
  enabled: boolean;
}) {
  const { field, fieldState: { error } } = useController({ name: 'company', control });
  const [composing, setComposing] = React.useState(false);
  const composingRef = React.useRef(false);
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(-1);
  const [expandedCompany, setExpandedCompany] = React.useState('');
  const [lookup, setLookup] = React.useState<Lookup>();
  const listId = React.useId();
  const historyId = React.useId();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const { ref: formInputRef } = field;
  const registerInput = React.useCallback((node: HTMLInputElement | null) => {
    inputRef.current = node;
    formInputRef(node);
  }, [formInputRef]);
  const actionRef = React.useRef<HTMLButtonElement>(null);

  const query = !composing && enabled ? (field.value ?? '').trim() : '';
  const searchable = query.length > 0 && query.length <= LEASE_COMPANY_NAME_MAX_LENGTH;
  const result = searchable && lookup?.query === query ? lookup.result : undefined;
  const options = result?.suggestions ?? [];
  const expanded = Boolean(result?.hasRecentDeals && expandedCompany === query);
  const menuVisible = open && searchable && !expanded;
  const scheduleAssessment = menuVisible && result?.canAssessSimilar === true;
  const activeIndex = menuVisible && highlighted < options.length ? highlighted : -1;

  React.useEffect(() => {
    if (!searchable) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      searchLeaseCompanies(query, controller.signal).then(
        (result) => { if (!controller.signal.aborted) setLookup({ query, result }); },
        () => { if (!controller.signal.aborted) setLookup({ query, result: null }); },
      );
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, searchable]);

  React.useEffect(() => {
    if (!scheduleAssessment) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      // A fresh lookup may surface validated hints later. Do not poll or
      // reorder the menu while a person is using it.
      void scheduleLeaseCompanyAssessment(query, controller.signal).catch(() => {});
    }, 900);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, scheduleAssessment]);

  React.useEffect(() => {
    if (activeIndex >= 0) document.getElementById(`${listId}-${activeIndex}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, listId]);

  function closeSuggestions() {
    setOpen(false);
    setHighlighted(-1);
  }

  function choose(company: string) {
    field.onChange(company);
    setExpandedCompany('');
    inputRef.current?.focus();
    closeSuggestions();
  }

  return (
    <div
      className="min-w-0"
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) closeSuggestions(); }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) {
          event.stopPropagation();
        } else if (menuVisible || expanded) {
          event.preventDefault();
          event.stopPropagation();
          if (expanded) { setExpandedCompany(''); actionRef.current?.focus(); }
          else closeSuggestions();
        }
      }}
    >
      <label htmlFor="company" className={`mb-1 block text-xs font-medium ${error ? 'text-rose-700' : 'text-slate-600'}`}>
        企业名称<span className="ml-0.5 text-rose-600" aria-hidden="true">*</span>
      </label>
      <div className="relative">
        <input
          {...field}
          ref={registerInput}
          value={field.value ?? ''}
          id="company"
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuVisible && options.length > 0}
          aria-controls={menuVisible && options.length > 0 ? listId : undefined}
          aria-activedescendant={activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          aria-required="true"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'company-error' : undefined}
          placeholder="请输入企业名称"
          autoComplete="off"
          className={`min-h-11 w-full rounded-md border px-2.5 py-2 text-base outline-none focus:border-[var(--cd-color-brand)] focus:ring-2 focus:ring-[var(--cd-color-brand)]/20 sm:pointer-fine:min-h-9 sm:pointer-fine:text-sm ${error ? 'border-rose-400 bg-rose-50/40 text-rose-900' : 'border-slate-300 bg-white text-slate-900 hover:border-slate-400'}`}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            field.onChange(event);
            setExpandedCompany('');
            setHighlighted(-1);
            setOpen(true);
          }}
          onCompositionStart={() => {
            composingRef.current = true;
            setComposing(true);
            setHighlighted(-1);
          }}
          onCompositionEnd={(event) => {
            composingRef.current = false;
            field.onChange(event.currentTarget.value);
            setComposing(false);
          }}
          onKeyDown={(event) => {
            if (composingRef.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              if (activeIndex >= 0) choose(options[activeIndex].company);
              else closeSuggestions();
            } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length && !expanded) {
              event.preventDefault();
              setOpen(true);
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setHighlighted(activeIndex < 0 ? (step > 0 ? 0 : options.length - 1) : (activeIndex + step + options.length) % options.length);
            }
          }}
        />
        {error && <p id="company-error" role="alert" className="mt-1 text-xs leading-4 text-rose-600">{error.message}</p>}
        <span role="status" className="sr-only">{result?.hasRecentDeals ? '有可查看的近期成交' : ''}</span>
        {result?.hasRecentDeals && (
          <button
            ref={actionRef}
            type="button"
            className={linkClass}
            aria-expanded={expanded}
            aria-controls={expanded ? historyId : undefined}
            onClick={() => {
              closeSuggestions();
              setExpandedCompany(expanded ? '' : query);
            }}
          >
            <History size={16} aria-hidden="true" />
            {expanded ? '收起近期成交' : '查看近期成交'}
            <ChevronDown size={14} aria-hidden="true" className={expanded ? 'rotate-180' : undefined} />
          </button>
        )}
        {menuVisible && options.length > 0 && (
          <div className="absolute left-0 top-full z-20 mt-1 w-full overflow-hidden rounded-md border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] text-sm shadow-md">
            <ul id={listId} role="listbox" aria-label="已有成交企业" className="max-h-44 overflow-y-auto overscroll-contain">
              {options.map((option, index) => (
                <li key={option.company} role="presentation">
                  <button
                    type="button"
                    id={`${listId}-${index}`}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    className={`block min-h-11 w-full break-words px-3 py-2 text-left hover:bg-[var(--cd-color-brand-soft)] ${index === activeIndex ? 'bg-[var(--cd-color-brand-soft)]' : ''}`}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(option.company)}
                  >
                    {option.company}
                    {(option.relation || option.matchedFullName) && (
                      <span className="block text-[var(--cd-color-text-secondary)]">
                        {option.relation === 'same_company' ? '可能是同一家企业' : option.relation === 'related_company' ? '可能是关联企业' : null}
                        {option.relation && option.matchedFullName ? ' · ' : null}
                        {option.matchedFullName ? `疑似全称：${option.matchedFullName}` : null}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {menuVisible && options.length === 0 && (
          <p role="status" className="mt-1 text-sm text-[var(--cd-color-text-secondary)]">
            {result === undefined ? '正在查找已有企业…' : result === null ? '暂时无法联想，可继续手动填写' : '未找到匹配企业，可继续手动填写'}
          </p>
        )}
      </div>
      {expanded && <RecentDeals key={query} id={historyId} company={query} />}
    </div>
  );
}
