'use client';

import * as React from 'react';
import { AppHeader, Button } from '@/src/components/ui';
import { SearchBar } from '@/src/components/SearchBar';
import { ChevronDown, X } from 'lucide-react';
import { isCommercialFutureSupply, type ActiveFilterChip } from '../model/mapDomain';
import type { SidebarFilterState } from '@/src/components/SidebarFilter';
import { MaskedText } from '@/src/components/demo';
import { displayListGrade, hasBuildingLocation, listBuildingValues, listVacancyPercent, sortFullList, type FullListBuilding, type FullListSort } from '../model/fullBuildingList';
import { FULL_LIST_QUICK_FILTER_KEYS, FullListQuickFilters } from './FullListQuickFilters';
import styles from './FullBuildingList.module.css';

export type ListDisplayOverrides = Map<string, Map<string, { display_label: string; display_value: string }>>;

type Props = {
  active: boolean;
  searchContextKey?: string;
  buildings: FullListBuilding[];
  queryKey: string;
  activeFilterChips: ActiveFilterChip[];
  compareGroupCount: number;
  requirementContext: boolean;
  competitorContext: boolean;
  filterState: SidebarFilterState | null;
  onPatchFilters: (patch: Partial<SidebarFilterState>) => void;
  keyword: string;
  loading: boolean;
  error: string | null;
  warning?: string | null;
  filtersOpen: boolean;
  moreFiltersTriggerId?: string;
  filtersPanelId?: string;
  displayOverrides: ListDisplayOverrides;
  targetBuildingId: string | null;
  onBack: () => void;
  onToggleFilters: () => void;
  onKeywordChange: (value: string) => void;
  onSearch: (value: string) => void | Promise<void>;
  onResetFilters: () => void;
  onRetry: () => void;
  onBuildingClick: (building: FullListBuilding) => void;
};

const PAGE_SIZE = 20;
function format(value: number | null, digits: number, unit: string) {
  return value === null ? '—' : `${value.toLocaleString('zh-CN', { maximumFractionDigits: digits })} ${unit}`;
}

export function FullBuildingList({ active, searchContextKey, buildings, queryKey, activeFilterChips, compareGroupCount, requirementContext, competitorContext, filterState, onPatchFilters, keyword, loading, error, warning, filtersOpen, moreFiltersTriggerId, filtersPanelId, displayOverrides, targetBuildingId, onBack, onToggleFilters, onKeywordChange, onSearch, onResetFilters, onRetry, onBuildingClick }: Props) {
  const [sort, setSort] = React.useState<FullListSort>('default');
  const [paging, setPaging] = React.useState({ queryKey, page: 1 });
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const rootRef = React.useRef<HTMLElement>(null);
  const savedScroll = React.useRef(0);
  const sorted = React.useMemo(() => sortFullList(buildings, sort), [buildings, sort]);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = paging.queryKey === queryKey ? Math.min(paging.page, pages) : 1;
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const periods = React.useMemo(() => new Set(buildings.map(building => listBuildingValues(building).period).filter(Boolean)), [buildings]);
  const moreFilterChips = activeFilterChips.filter(chip => !FULL_LIST_QUICK_FILTER_KEYS.has(chip.id));

  if (paging.queryKey !== queryKey || paging.page !== page) setPaging({ queryKey, page });

  React.useEffect(() => {
    savedScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [queryKey]);

  React.useLayoutEffect(() => {
    if (!active) return;
    if (scrollRef.current) scrollRef.current.scrollTop = savedScroll.current;
    const heading = rootRef.current?.querySelector('h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [active]);

  const movePage = (next: number, focusResults = false) => {
    if (focusResults) rootRef.current?.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true });
    setPaging({ queryKey, page: next });
    savedScroll.current = 0;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  };

  return (
    <section ref={rootRef} className={styles.workspace} aria-label="完整楼宇列表">
      <header className={styles.header}>
        <AppHeader title="楼宇列表" actions={<Button variant="secondary" onClick={onBack}>返回地图</Button>} />
      </header>
      <div className={styles.query}>
        <div className={styles.search}>
          <SearchBar searchContextKey={searchContextKey} inputLabel="搜索楼宇、子市场、业主或物业" value={keyword} placeholder="搜索楼宇、子市场、业主…" onChange={onKeywordChange} onSearch={value => { void onSearch(value); }} />
        </div>
        <div className={styles.filterBar}>
          <FullListQuickFilters key={searchContextKey} active={active} filterState={filterState} onPatchFilters={onPatchFilters} />
          <Button variant="secondary" id={moreFiltersTriggerId} onClick={onToggleFilters} aria-expanded={filtersOpen}
            aria-controls={filtersOpen ? filtersPanelId : undefined}>更多筛选<ChevronDown size={14} aria-hidden="true" /></Button>
          <Button variant="ghost" onClick={onResetFilters}>清空条件</Button>
        </div>
      </div>
      <div className={styles.scroll} ref={scrollRef} data-testid="full-list-scroll" onScroll={event => {
        if (active) savedScroll.current = event.currentTarget.scrollTop;
      }}>
        <div className={styles.content}>
          {(moreFilterChips.length > 0 || compareGroupCount > 0 || requirementContext || competitorContext) ? (
            <div className={styles.activeFilters} role="group" aria-label="已生效筛选条件">
              {requirementContext ? <span>客户需求候选</span> : null}
              {competitorContext ? <span>竞品分析结果</span> : null}
              {moreFilterChips.map(chip => <Button key={chip.id} variant="ghost" onClick={() => onPatchFilters(chip.patch)} aria-label={`移除条件：${chip.label}`}>{chip.label}<X size={14} aria-hidden="true" /></Button>)}
              {compareGroupCount > 0 ? <span>项目对比组 {compareGroupCount}</span> : null}
            </div>
          ) : null}
          <div className={styles.controls}>
            <div className={styles.scope}><span role="status">{loading ? '正在更新楼宇…' : `${buildings.length} 栋楼宇`}</span>{!loading && periods.size > 1 ? <span className={styles.periodNote}>各楼宇数据季度可能不同</span> : null}</div>
            <label className={styles.sort}><span>排序</span><select aria-label="楼宇排序" value={sort} onChange={event => { setSort(event.target.value as FullListSort); movePage(1); }}>
              <option value="default">默认顺序</option>
              <option value="name">名称</option>
              <option value="area">面积：从大到小</option>
              <option value="rent">净有效租金：从低到高</option>
              <option value="rent-desc">净有效租金：从高到低</option>
              <option value="vacancy">空置率：从低到高</option>
              <option value="vacancy-desc">空置率：从高到低</option>
            </select></label>
          </div>
          {warning ? <p className={styles.warning} role="status">{warning}</p> : null}
          {error ? <div className={styles.status} role="alert"><h2>楼宇数据暂时无法读取</h2><p>{error}</p><Button variant="secondary" onClick={onRetry}>重新读取</Button></div> : (
            <div aria-busy={loading}>
              {visible.map(building => {
                const values = listBuildingValues(building), future = building._dataType === 'future';
                const grade = displayOverrides.get(building.id)?.get('grade')?.display_value ?? displayListGrade(building.grade);
                const submarket = displayOverrides.get(building.id)?.get('submarket')?.display_value ?? building.submarket;
                const vacancy = listVacancyPercent(values.vacancy);
                const locationAvailable = hasBuildingLocation(building);
                const year = future ? building.launch_year : building.completion_year;
                return <article className={styles.row} key={`${building._dataType ?? 'existing'}:${building.id}`} data-building-id={building.id} aria-current={targetBuildingId === building.id ? 'true' : undefined}>
                  <div className={styles.identity}>
                    <button className={styles.name} title="在地图中查看详情" disabled={loading || !locationAvailable} onClick={() => {
                      if (scrollRef.current) savedScroll.current = scrollRef.current.scrollTop;
                      onBuildingClick(building);
                    }}><MaskedText>{building.name || '未命名项目'}</MaskedText></button>
                    <div className={styles.meta}>
                      {year ? <span>{year}年{future ? '预计供应' : ''}</span> : null}
                      {future ? <span>{isCommercialFutureSupply(building) ? '商业未来供应' : '未来供应'}</span> : null}
                      {targetBuildingId === building.id ? <span>目标楼宇</span> : null}
                    </div>
                  </div>
                  <dl className={styles.facts}>
                    <div><dt>区位</dt><dd>{[building.district, submarket].filter(Boolean).join(' · ') || '—'}</dd></div>
                    <div><dt>等级</dt><dd>{grade}</dd></div>
                    <div><dt>统计面积</dt><dd>{format(values.area, 0, '㎡')}</dd></div>
                    <div><dt>净有效租金</dt><dd>{format(values.rent, 2, '元/㎡/月')}</dd></div>
                    <div><dt>空置率</dt><dd>{vacancy === null ? '—' : `${vacancy.toFixed(1)}%`}</dd></div>
                  </dl>
                  {!locationAvailable ? <p className={styles.locationNote}>位置待完善，暂无法在地图中查看详情</p> : null}
                </article>;
              })}
              {!loading && !buildings.length ? <div className={styles.status}><h2>未找到符合条件的楼宇</h2><p>减少筛选条件或换一个关键词继续查找。</p><Button variant="secondary" onClick={onResetFilters}>清空条件</Button></div> : null}
              <footer className={styles.footer}><span className={styles.context}>第 {page} / {pages} 页</span><nav className={styles.pages} aria-label="完整列表分页"><Button variant="secondary" disabled={loading || page <= 1} onClick={() => movePage(page - 1, true)}>上一页</Button><Button variant="secondary" disabled={loading || page >= pages} onClick={() => movePage(page + 1, true)}>下一页</Button></nav></footer>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
