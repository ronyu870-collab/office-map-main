'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/src/components/ui';
import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { createDefaultFilterState } from '../model/mapDomain';
import styles from './FullBuildingList.module.css';

const GROUPS = [
  { key: 'districts', label: '行政区' },
  { key: 'submarkets', label: '子市场' },
  { key: 'projectTypes', label: '项目类型' },
] as const;
type FilterKey = typeof GROUPS[number]['key'];
const DEFAULT_FILTERS = createDefaultFilterState();
export const FULL_LIST_QUICK_FILTER_KEYS: ReadonlySet<string> = new Set(GROUPS.map(group => group.key));

export function FullListQuickFilters({
  active, filterState, onPatchFilters,
}: {
  active: boolean;
  filterState: SidebarFilterState | null;
  onPatchFilters: (patch: Partial<SidebarFilterState>) => void;
}) {
  const [openGroup, setOpenGroup] = React.useState<FilterKey | null>(null);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const setSelection = (key: FilterKey, next: string[]) => {
    // The map uses these defaults before the shared sidebar emits its first state.
    onPatchFilters({ ...(!filterState ? DEFAULT_FILTERS : {}), [key]: next });
  };

  React.useEffect(() => {
    if (!active || !openGroup) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpenGroup(null);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [active, openGroup]);

  return (
    <div className={styles.quickFilters} ref={rootRef} role="group" aria-label="常用筛选"
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpenGroup(null);
      }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || !openGroup) return;
        event.preventDefault();
        document.getElementById(`${id}-${openGroup}-trigger`)?.focus();
        setOpenGroup(null);
      }}>
      {GROUPS.map(({ key, label }) => {
        const options = DEFAULT_FILTERS[key];
        const selected = filterState?.[key] ?? options;
        const all = (key !== 'projectTypes' && selected.length === 0)
          || (selected.length === options.length && options.every(option => selected.includes(option)));
        const expanded = active && openGroup === key;
        const summary = all ? '全部'
          : selected.length > 2 ? `${selected.slice(0, 2).join('、')}等${selected.length}项`
          : selected.join('、') || '未选择';
        const triggerId = `${id}-${key}-trigger`;
        const panelId = `${id}-${key}-options`;
        return (
          <div className={styles.quickGroup} key={key}>
            <Button variant="secondary" id={triggerId} className={styles.quickTrigger}
              aria-label={label} aria-description={summary} aria-expanded={expanded} aria-controls={expanded ? panelId : undefined}
              data-selected={!all || undefined} onClick={() => setOpenGroup(expanded ? null : key)}>
              <span>{label}</span><span className={styles.quickValue}>{summary}</span><ChevronDown size={14} aria-hidden="true" />
            </Button>
            {expanded && (
              <div id={panelId} role="group" aria-labelledby={triggerId} className={styles.quickPanel}>
                <Button variant={all ? 'secondary' : 'ghost'} className={styles.allOptions} aria-pressed={all}
                  onClick={() => { if (!all) setSelection(key, options); }}>
                  全部{label}
                </Button>
                <div className={styles.quickOptions}>
                  {options.map(option => (
                    <label key={option} className={styles.quickOption}>
                      <input type="checkbox" checked={!all && selected.includes(option)} onChange={() => {
                        const next = all ? [option] : selected.includes(option)
                          ? selected.filter(item => item !== option) : [...selected, option];
                        setSelection(key, next.length ? next : options);
                      }} />
                      <span>{option}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
