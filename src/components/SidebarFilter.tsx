'use client';

import * as React from 'react';

export interface NumericCondition {
  id: string;
  field: 'net_effective_rent' | 'vacancy_rate' | 'vacant_area' | 'total_area' | 'management_fee' | 'owner' | 'property_management';
  operator: '>=' | '<=' | '=' | '>' | '<';
  value: number | string | '';
}

export interface CompareGroup {
  id: string;
  name: string;
  color: string;
  submarkets: string[];
  grades: string[];
  districts: string[];
}

const GROUP_COLORS = ['#3b82f6', '#f97316', '#10b981', '#8b5cf6', '#ec4899'];

export interface SidebarFilterState {
  districts: string[];
  submarkets: string[];
  leeds: string[];
  projectTypes: string[];
  showBoundaries: boolean;
  subwayLine: string | null;
  subwayStation: any | null;
  subwayDistance: number | null;
  numericFilters: NumericCondition[];
  showFutureSupply: boolean;
  futureSupplyGrades: string[];
  futureSupplyYears: string[];
}

export interface SidebarFilterCommand {
  id: number;
  type: 'reset' | 'patch';
  patch?: Partial<SidebarFilterState>;
}

export interface SidebarFilterProps {
  districts: string[]; submarkets?: string[]; submarketsSecondary?: string[]; leeds?: string[];
  grades?: any[]; areaRanges?: any[]; // 保留可选参数防止父组件报错
  subwayLines: string[]; availableStations: any[]; initialState?: Partial<SidebarFilterState>;
  onFilterChange: (state: SidebarFilterState) => void; title?: string;
  onCompareGroupsChange?: (groups: CompareGroup[]) => void;
  filterCommand?: SidebarFilterCommand | null;
  embedded?: boolean;
  defaultExpanded?: boolean;
}

function uniqStrings(items: string[]): string[] { 
  const seen = new Set<string>(); const out: string[] = []; 
  for (const s of items) { const v = String(s).trim(); if (!v || seen.has(v)) continue; seen.add(v); out.push(v); } 
  return out; 
}

function sameStringList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => ( 
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : 'text-zinc-400'}`}><polyline points="6 9 12 15 18 9"></polyline></svg> 
);

const TrashIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 hover:text-red-700 transition-colors"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
);

const PlusIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mr-1"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
);

const NUMERIC_FIELDS = [
  { value: 'net_effective_rent', label: '净有效租金' },
  { value: 'vacancy_rate', label: '空置率 (%)' },
  { value: 'vacant_area', label: '空置面积' },
  { value: 'total_area', label: '总面积' },
  { value: 'management_fee', label: '物业费' },
  { value: 'owner', label: '项目业主' },
  { value: 'property_management', label: '物业公司' },
];

const TEXT_FIELDS = new Set(['owner', 'property_management']);

const NUMERIC_OPERATORS = [
  { value: '>=', label: '≥' },
  { value: '<=', label: '≤' },
  { value: '=', label: '=' },
  { value: '>', label: '>' },
  { value: '<', label: '<' }
];

export function SidebarFilter(props: SidebarFilterProps) {
  const title = props.title ?? '全局筛选';
  const districts = React.useMemo(() => uniqStrings(props.districts), [props.districts]);
  const submarkets = React.useMemo(() => uniqStrings(props.submarkets ?? []), [props.submarkets]);
  const submarketsSecondary = React.useMemo(() => uniqStrings(props.submarketsSecondary ?? []), [props.submarketsSecondary]);
  const allSubmarkets = React.useMemo(() => [...submarkets, ...submarketsSecondary], [submarkets, submarketsSecondary]);
  const leeds = React.useMemo(() => uniqStrings(props.leeds ?? []), [props.leeds]);
  const subwayLines = React.useMemo(() => uniqStrings(props.subwayLines), [props.subwayLines]);

  const [isMobileOpen, setIsMobileOpen] = React.useState(false);
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({
    projectTypes: false, districts: false, submarkets: false, leeds: false, subway: false, numeric: false
  });

  // ── 全局筛选折叠状态 ──
  const [globalFilterOpen, setGlobalFilterOpen] = React.useState(props.defaultExpanded ?? false);

  // ── 项目对比筛选状态 ──
  const [compareGroups, setCompareGroups] = React.useState<CompareGroup[]>([]);
  const [openCompareGroups, setOpenCompareGroups] = React.useState<Record<string, boolean>>({});
  const [compareSectionOpen, setCompareSectionOpen] = React.useState(false);

  const toggleSection = (key: string) => { setOpenSections(prev => ({ ...prev, [key]: !prev[key] })); };

  const [state, setState] = React.useState<SidebarFilterState>(() => ({
    districts: uniqStrings(props.initialState?.districts ?? districts),
    submarkets: uniqStrings(props.initialState?.submarkets ?? submarkets),
    leeds: uniqStrings(props.initialState?.leeds ?? leeds),
    projectTypes: props.initialState?.projectTypes ?? ['甲级写字楼', '乙级写字楼', '产业园区'],
    showBoundaries: false,
    subwayLine: null,
    subwayStation: null,
    subwayDistance: 1000,
    numericFilters: [],
    showFutureSupply: false,
    futureSupplyGrades: ['A', 'B', 'BP'],
    futureSupplyYears: ['2026', '2027', '2028', '2029AndAfter', 'noDate'],
  }));

  // 当 props 的可选项列表变化时，将新增的选项自动加入已选列表
  React.useEffect(() => {
    setState(prev => {
      const nextDistricts = uniqStrings([...prev.districts, ...districts]);
      const nextSubmarkets = uniqStrings([...prev.submarkets, ...allSubmarkets]);
      const nextLeeds = uniqStrings([...prev.leeds, ...leeds]);

      // 首次挂载时默认选项本已完整；保持原对象可避免将初始化误发为一次用户筛选。
      if (
        sameStringList(prev.districts, nextDistricts) &&
        sameStringList(prev.submarkets, nextSubmarkets) &&
        sameStringList(prev.leeds, nextLeeds)
      ) {
        return prev;
      }

      return {
        ...prev,
        districts: nextDistricts,
        submarkets: nextSubmarkets,
        leeds: nextLeeds,
      };
    });
  }, [districts, allSubmarkets, leeds]);

  const onFilterChangeRef = React.useRef(props.onFilterChange);
  React.useEffect(() => { onFilterChangeRef.current = props.onFilterChange; }, [props.onFilterChange]);

  const isFirstEmit = React.useRef(true);
  React.useEffect(() => {
    if (isFirstEmit.current) { isFirstEmit.current = false; return; }
    onFilterChangeRef.current(state);
  }, [state]);

  const currentDistricts = state.districts || [];
  const currentSubmarkets = state.submarkets || [];
  const currentLeeds = state.leeds || [];

  const allDistrictsSelected = currentDistricts.length === districts.length && districts.length > 0;
  const partiallyDistrictsSelected = currentDistricts.length > 0 && currentDistricts.length < districts.length;
  const allSubmarketsSelected = currentSubmarkets.length === allSubmarkets.length && allSubmarkets.length > 0;
  const partiallySubmarketsSelected = currentSubmarkets.length > 0 && currentSubmarkets.length < allSubmarkets.length;
  const allLeedsSelected = currentLeeds.length === leeds.length && leeds.length > 0;
  const partiallyLeedsSelected = currentLeeds.length > 0 && currentLeeds.length < leeds.length;

  function toggleAllDistricts(next: boolean) { setState(prev => ({ ...prev, districts: next ? districts : [] })); }
  function toggleDistrict(d: string) { setState(prev => { const set = new Set(prev.districts || []); set.has(d) ? set.delete(d) : set.add(d); return { ...prev, districts: Array.from(set) }; }); }
  function toggleAllSubmarkets(next: boolean) { setState(prev => ({ ...prev, submarkets: next ? allSubmarkets : [] })); }
  function toggleSubmarket(s: string) { setState(prev => { const set = new Set(prev.submarkets || []); set.has(s) ? set.delete(s) : set.add(s); return { ...prev, submarkets: Array.from(set) }; }); }
  function toggleAllLeeds(next: boolean) { setState(prev => ({ ...prev, leeds: next ? leeds : [] })); }
  function toggleLeed(l: string) { setState(prev => { const set = new Set(prev.leeds || []); set.has(l) ? set.delete(l) : set.add(l); return { ...prev, leeds: Array.from(set) }; }); }

  function addNumericFilter() {
    setState(prev => ({
      ...prev,
      numericFilters: [...(prev.numericFilters || []), { id: Date.now().toString(), field: 'net_effective_rent', operator: '>=', value: '' }]
    }));
  }
  function removeNumericFilter(id: string) {
    setState(prev => ({
      ...prev,
      numericFilters: (prev.numericFilters || []).filter(f => f.id !== id)
    }));
  }
  function updateNumericFilter(id: string, key: keyof NumericCondition, val: any) {
    setState(prev => ({
      ...prev,
      numericFilters: (prev.numericFilters || []).map(f => {
        if (f.id !== id) return f;
        const updated = { ...f, [key]: val };
        if (key === 'field' && TEXT_FIELDS.has(val)) {
          updated.operator = '=';
          updated.value = '';
        }
        return updated;
      })
    }));
  }

  const reset = React.useCallback(() => {
    setState({
      districts,
      submarkets: allSubmarkets,
      leeds,
      projectTypes: ['甲级写字楼', '乙级写字楼', '产业园区'],
      showBoundaries: false,
      subwayLine: null,
      subwayStation: null,
      subwayDistance: 1000,
      numericFilters: [],
      showFutureSupply: false,
      futureSupplyGrades: ['A', 'B', 'BP'],
      futureSupplyYears: ['2026', '2027', '2028', '2029AndAfter', 'noDate'],
    });
  }, [districts, allSubmarkets]);

  // 允许地图页的已生效条件标签触发单项删除或整体清空，筛选逻辑仍由本组件统一维护。
  React.useEffect(() => {
    const command = props.filterCommand;
    if (!command) return;
    if (command.type === 'reset') {
      // External command intentionally synchronizes the internal filter state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      reset();
      return;
    }
    if (command.patch) {
      // External command intentionally synchronizes the internal filter state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState(prev => ({ ...prev, ...command.patch }));
    }
  }, [props.filterCommand, reset]);

  // ── 项目对比筛选处理函数 ──
  const onCompareGroupsChangeRef = React.useRef(props.onCompareGroupsChange);
  React.useEffect(() => { onCompareGroupsChangeRef.current = props.onCompareGroupsChange; }, [props.onCompareGroupsChange]);

  React.useEffect(() => { onCompareGroupsChangeRef.current?.(compareGroups); }, [compareGroups]);

  function addCompareGroup() {
    const idx = compareGroups.length;
    const newGroup: CompareGroup = {
      id: Date.now().toString(),
      name: `组${idx + 1}`,
      color: GROUP_COLORS[idx % GROUP_COLORS.length],
      submarkets: [],
      grades: [],
      districts: [],
    };
    setCompareGroups(prev => [...prev, newGroup]);
    setOpenCompareGroups(prev => ({ ...prev, [newGroup.id]: true }));
  }

  function removeCompareGroup(id: string) {
    setCompareGroups(prev => prev.filter(g => g.id !== id));
    setOpenCompareGroups(prev => { const n = { ...prev }; delete n[id]; return n; });
  }

  function updateCompareGroup(id: string, updates: Partial<CompareGroup>) {
    setCompareGroups(prev => prev.map(g => g.id === id ? { ...g, ...updates } : g));
  }

  function toggleGroupSubmarket(groupId: string, submarket: string) {
    setCompareGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const set = new Set(g.submarkets);
      set.has(submarket) ? set.delete(submarket) : set.add(submarket);
      return { ...g, submarkets: Array.from(set) };
    }));
  }

  function toggleGroupGrade(groupId: string, grade: string) {
    setCompareGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const set = new Set(g.grades);
      set.has(grade) ? set.delete(grade) : set.add(grade);
      return { ...g, grades: Array.from(set) };
    }));
  }

  function toggleGroupDistrict(groupId: string, district: string) {
    setCompareGroups(prev => prev.map(g => {
      if (g.id !== groupId) return g;
      const set = new Set(g.districts);
      set.has(district) ? set.delete(district) : set.add(district);
      return { ...g, districts: Array.from(set) };
    }));
  }

  return (
    <aside className="w-full">
      <div className={`${props.embedded ? 'hidden' : 'flex'} items-center justify-between gap-3 rounded-md border border-zinc-200/60 bg-white px-3 py-2 sm:hidden`}>
        <div className="min-w-0"><div className="text-[12px] font-semibold tracking-wide text-zinc-900">{title}</div></div>
        <button type="button" onClick={() => setIsMobileOpen(v => !v)} className="shrink-0 rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-[12px] font-medium text-zinc-700">{isMobileOpen ? '收起' : '展开筛选'}</button>
      </div>

      <div className={`${props.embedded ? 'block' : isMobileOpen ? 'block' : 'hidden'} sm:block`}>
        <div className={props.embedded ? 'bg-transparent p-0' : 'mt-2 rounded-md border border-zinc-200/60 bg-white p-3 sm:mt-0'}>
          <div
            className={`${props.embedded ? 'flex' : 'hidden sm:flex'} items-center justify-between mb-2 pb-2 border-b border-zinc-100 cursor-pointer hover:bg-zinc-50 -mx-1 px-1 py-1 rounded-md transition-colors`}
            onClick={() => setGlobalFilterOpen(v => !v)}
          >
            <div className="text-[13px] font-bold tracking-wide text-zinc-900">{title}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={e => { e.stopPropagation(); reset(); }} className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 transition-colors">重置</button>
              <ChevronIcon isOpen={globalFilterOpen} />
            </div>
          </div>

          {globalFilterOpen && (
          <div className="animate-in slide-in-from-top-1 fade-in duration-200">
          {/* ================= 🌟 项目类型大调整 ================= */}
          <section className="mb-1">
            <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors group" onClick={() => toggleSection('projectTypes')}>
              <div className="text-[12px] font-semibold text-zinc-800">项目类型</div>
              <ChevronIcon isOpen={openSections.projectTypes} />
            </div>
            {openSections.projectTypes && (
              <div className="mt-1 mb-3 px-1">
                
                {/* 第一部分：现有项目 */}
                <div className="mb-3">
                  <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={state.projectTypes.length === 3} 
                      ref={el => { if (el) el.indeterminate = state.projectTypes.length > 0 && state.projectTypes.length < 3; }} 
                      onChange={e => setState(p => ({ ...p, projectTypes: e.target.checked ? ['甲级写字楼', '乙级写字楼', '产业园区'] : [] }))} 
                      className="h-4 w-4 rounded border-zinc-300 text-primary transition-colors" 
                    /> 全选 (现有项目)
                  </label>
                  <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                    {['甲级写字楼', '乙级写字楼', '产业园区'].map(pt => (
                      <label key={pt} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={state.projectTypes.includes(pt)} 
                          onChange={() => setState(prev => {
                            const set = new Set(prev.projectTypes);
                            set.has(pt) ? set.delete(pt) : set.add(pt);
                            return { ...prev, projectTypes: Array.from(set) };
                          })} 
                          className="h-4 w-4 rounded border-zinc-300 text-blue-700" 
                        />
                        <span className="truncate text-[11px] text-zinc-700">{pt}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* 第二部分：未来新增供应（嵌套细分项） */}
                <div className="pt-2 border-t border-zinc-100">
                  <label className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:bg-emerald-50 cursor-pointer transition-colors">
                    <input
                      type="checkbox"
                      checked={state.showFutureSupply}
                      onChange={e => {
                        const checked = e.target.checked;
                        // 每次勾选大类时，默认全选子类
                        setState(p => ({ ...p, showFutureSupply: checked, futureSupplyGrades: checked ? ['A', 'B', 'BP'] : [], futureSupplyYears: checked ? ['2026', '2027', '2028', '2029AndAfter', 'noDate'] : [] }));
                      }}
                      className="h-4 w-4 rounded border-zinc-300 text-emerald-600 focus:ring-emerald-200"
                    />
                    <span className="truncate text-[12px] font-bold text-zinc-800">显示未来新增供应</span>
                  </label>
                  
                  {/* 子分类 A, B, BP */}
                  {state.showFutureSupply && (
                    <div className="ml-5 mt-1 grid gap-x-0 gap-y-2 border-l-2 border-emerald-100 pl-3" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                      {[
                        { id: 'A', label: '甲级' },
                        { id: 'B', label: '乙级' },
                        { id: 'BP', label: '产业园' }
                      ].map(grade => (
                        <label key={grade.id} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={(state.futureSupplyGrades || []).includes(grade.id)}
                            onChange={() => setState(prev => {
                              const set = new Set(prev.futureSupplyGrades || []);
                              set.has(grade.id) ? set.delete(grade.id) : set.add(grade.id);
                              return { ...prev, futureSupplyGrades: Array.from(set) };
                            })}
                            className="h-3.5 w-3.5 rounded border-zinc-300 text-emerald-500"
                          />
                          <span className="truncate text-[11px] text-zinc-600">{grade.label}</span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* 年份筛选 */}
                  {state.showFutureSupply && (
                    <div className="ml-5 mt-2 border-l-2 border-emerald-100 pl-3">
                      <div className="text-[10px] font-bold text-zinc-400 mb-1">入市年份</div>
                      <div className="flex flex-col gap-1">
                        {[
                          { id: '2026', label: '2026年' },
                          { id: '2027', label: '2027年' },
                          { id: '2028', label: '2028年' },
                          { id: '2029AndAfter', label: '2029年及以后' },
                          { id: 'noDate', label: '暂无供应时间' },
                        ].map(year => (
                          <label key={year.id} className="flex items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={(state.futureSupplyYears || []).includes(year.id)}
                              onChange={() => setState(prev => {
                                const set = new Set(prev.futureSupplyYears || []);
                                set.has(year.id) ? set.delete(year.id) : set.add(year.id);
                                return { ...prev, futureSupplyYears: Array.from(set) };
                              })}
                              className="h-3.5 w-3.5 rounded border-zinc-300 text-emerald-500"
                            />
                            <span className="text-[11px] text-zinc-600 whitespace-nowrap">{year.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

              </div>
            )}
          </section>

          <section className="mb-1 border-t border-zinc-100 pt-1">
            <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors group" onClick={() => toggleSection('districts')}>
              <div className="text-[12px] font-semibold text-zinc-800">行政区划</div>
              <ChevronIcon isOpen={openSections.districts} />
            </div>
            {openSections.districts && (
              <div className="mt-1 mb-3 px-1">
                <label className="flex items-center gap-2 mb-3 mt-1 text-[11px] font-bold text-blue-700 bg-blue-50 p-1.5 rounded-md cursor-pointer border border-blue-100">
                  <input type="checkbox" checked={state.showBoundaries} onChange={e => setState(p => ({ ...p, showBoundaries: e.target.checked }))} className="h-4 w-4 rounded border-blue-300 text-blue-700" /> 
                  开启行政区边界线 (地图高亮)
                </label>
                <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                  <input type="checkbox" checked={allDistrictsSelected} ref={el => { if (el) el.indeterminate = partiallyDistrictsSelected; }} onChange={e => toggleAllDistricts(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-200" /> 全选
                </label>
                <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                  {districts.map(d => (
                    <label key={d} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                      <input type="checkbox" checked={currentDistricts.includes(d)} onChange={() => toggleDistrict(d)} className="h-4 w-4 rounded border-zinc-300 text-blue-700" />
                      <span className="truncate text-[11px] text-zinc-700">{d}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </section>

          {allSubmarkets.length > 0 && (
            <section className="mb-1 border-t border-zinc-100 pt-1">
              <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors group" onClick={() => toggleSection('submarkets')}>
                <div className="text-[12px] font-semibold text-zinc-800">子市场</div>
                <ChevronIcon isOpen={openSections.submarkets} />
              </div>
              {openSections.submarkets && (
                <div className="mt-1 mb-3 px-1">
                  <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                    <input type="checkbox" checked={allSubmarketsSelected} ref={el => { if (el) el.indeterminate = partiallySubmarketsSelected; }} onChange={e => toggleAllSubmarkets(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-200" /> 全选
                  </label>
                  <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                    {submarkets.map(s => (
                      <label key={s} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                        <input type="checkbox" checked={currentSubmarkets.includes(s)} onChange={() => toggleSubmarket(s)} className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-200" />
                        <span className="truncate text-[11px] text-zinc-700">{s}</span>
                      </label>
                    ))}
                  </div>
                  {submarketsSecondary.length > 0 && (
                    <>
                      <div className="border-t border-dashed border-zinc-300 my-2" />
                      <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                        {submarketsSecondary.map(s => (
                          <label key={s} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                            <input type="checkbox" checked={currentSubmarkets.includes(s)} onChange={() => toggleSubmarket(s)} className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-200" />
                            <span className="truncate text-[11px] text-zinc-700">{s}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </section>
          )}

          {leeds.length > 0 && (
            <section className="mb-1 border-t border-zinc-100 pt-1">
              <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors group" onClick={() => toggleSection('leeds')}>
                <div className="text-[12px] font-semibold text-zinc-800">LEED 认证</div>
                <ChevronIcon isOpen={openSections.leeds} />
              </div>
              {openSections.leeds && (
                <div className="mt-1 mb-3 px-1">
                  <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                    <input type="checkbox" checked={allLeedsSelected} ref={el => { if (el) el.indeterminate = partiallyLeedsSelected; }} onChange={e => toggleAllLeeds(e.target.checked)} className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-200" /> 全选
                  </label>
                  <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                    {leeds.map(l => (
                      <label key={l} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                        <input type="checkbox" checked={currentLeeds.includes(l)} onChange={() => toggleLeed(l)} className="h-4 w-4 rounded border-zinc-300 text-blue-700 focus:ring-blue-200" />
                        <span className="truncate text-[11px] text-zinc-700">{l === 'NULL' ? '无认证' : l}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="mb-1 border-t border-zinc-100 pt-1">
            <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors group" onClick={() => toggleSection('subway')}>
              <div className="text-[12px] font-semibold text-zinc-800">地铁通勤辐射圈</div>
              <ChevronIcon isOpen={openSections.subway} />
            </div>
            {openSections.subway && (
              <div className="mt-1 mb-3 px-1">
                <div className="mb-2">
                  <select className="w-full text-[11px] p-1.5 border border-zinc-200 rounded-md bg-zinc-50 text-zinc-700 outline-none transition-colors focus:border-primary focus:bg-white" value={state.subwayLine || ''} onChange={e => { const val = e.target.value; setState(p => ({ ...p, subwayLine: val || null, subwayStation: null })); }}>
                    <option value="">-- 先选择地铁线 --</option>
                    {subwayLines.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </div>
                {state.subwayLine && props.availableStations.length > 0 && (
                  <div className="mb-2">
                    <select className="w-full text-[11px] p-1.5 border border-zinc-200 rounded-md bg-zinc-50 text-zinc-700 outline-none transition-colors focus:border-primary focus:bg-white" value={state.subwayStation?.name || ''} onChange={e => { const s = props.availableStations.find(st => st.name === e.target.value); setState(p => ({ ...p, subwayStation: s || null })); }}>
                      <option value="">-- 再选择沿线站点 --</option>
                      {props.availableStations.map(st => <option key={st.id} value={st.name}>{st.name}</option>)}
                    </select>
                  </div>
                )}
                {state.subwayStation && (
                  <div className="mt-3 bg-zinc-50 p-2 rounded-md border border-zinc-100">
                    <div className="text-[10px] font-bold text-zinc-500 mb-2">辐射距离：</div>
                    <div className="flex flex-wrap gap-1">
                      {[500, 1000, 3000, 5000].map(d => (
                        <button key={d} type="button" onClick={() => setState(p => ({ ...p, subwayDistance: d }))} className={`px-2 py-1 text-[10px] rounded-sm transition-colors ${state.subwayDistance === d ? 'bg-blue-600 text-white font-bold' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100'}`}>
                          {d >= 1000 ? `${d/1000}km` : `${d}m`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          <section className="mb-1 border-t border-zinc-100 pt-1">
            <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors group" onClick={() => toggleSection('numeric')}>
              <div className="text-[12px] font-semibold text-zinc-800">多重筛选</div>
              <ChevronIcon isOpen={openSections.numeric} />
            </div>
            
            {openSections.numeric && (
              <div className="mt-1 mb-2 px-1">
                <div className="flex flex-col gap-2 mb-2">
                  {state.numericFilters && state.numericFilters.map((filter) => {
                    const isText = TEXT_FIELDS.has(filter.field);
                    return (
                      <div key={filter.id} className="flex items-center gap-1.5">
                        <select
                          className="flex-1 text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 min-w-[70px] outline-none transition-colors focus:border-primary focus:bg-white"
                          value={filter.field}
                          onChange={e => updateNumericFilter(filter.id, 'field', e.target.value as any)}
                        >
                          {NUMERIC_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                        </select>

                        {isText ? (
                          <span className="text-[11px] px-1 text-zinc-400 w-[42px] text-center">含</span>
                        ) : (
                          <select
                            className="text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 w-[42px] outline-none transition-colors focus:border-primary focus:bg-white text-center"
                            value={filter.operator}
                            onChange={e => updateNumericFilter(filter.id, 'operator', e.target.value as any)}
                          >
                            {NUMERIC_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                          </select>
                        )}

                        {isText ? (
                          <input
                            type="text"
                            placeholder="模糊搜索"
                            className="flex-1 text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 min-w-[50px] outline-none transition-colors focus:border-primary focus:bg-white"
                            value={filter.value}
                            onChange={e => updateNumericFilter(filter.id, 'value', e.target.value)}
                          />
                        ) : (
                          <input
                            type="number"
                            placeholder="数值"
                            className="flex-1 text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 min-w-[50px] outline-none transition-colors focus:border-primary focus:bg-white"
                            value={filter.value}
                            onChange={e => updateNumericFilter(filter.id, 'value', e.target.value ? Number(e.target.value) : '')}
                          />
                        )}

                        <button
                          type="button"
                          onClick={() => removeNumericFilter(filter.id)}
                          className="p-1.5 flex items-center justify-center hover:bg-red-50 rounded transition-colors shrink-0"
                          title="删除条件"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={addNumericFilter}
                  className="w-full flex items-center justify-center py-1.5 border border-dashed border-zinc-300 rounded-md text-[11px] text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors font-medium"
                >
                  <PlusIcon /> 添加条件
                </button>
              </div>
            )}
          </section>
          </div>
          )}
        </div>
      </div>

      {/* ================= 项目对比筛选（独立区块） ================= */}
      <div className="mt-2 rounded-md border border-zinc-200/60 bg-white p-3">
        <div
          className="flex items-center justify-between cursor-pointer py-1 px-1 rounded-md hover:bg-zinc-50 transition-colors"
          onClick={() => setCompareSectionOpen(v => !v)}
        >
          <div className="text-[13px] font-bold tracking-wide text-zinc-900">项目对比筛选</div>
          <ChevronIcon isOpen={compareSectionOpen} />
        </div>

        {compareSectionOpen && (
          <div className="mt-2">
            {compareGroups.map(group => (
              <div key={group.id} className="mb-2 rounded-md border border-zinc-100 bg-zinc-50/50">
                <div
                  className="flex items-center justify-between cursor-pointer py-2 px-2 hover:bg-zinc-100 rounded-md transition-colors"
                  onClick={() => setOpenCompareGroups(prev => ({ ...prev, [group.id]: !prev[group.id] }))}
                >
                  <div className="flex items-center gap-2">
                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: group.color }} />
                    <span className="text-[12px] font-semibold text-zinc-800">{group.name}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removeCompareGroup(group.id); }}
                      className="p-1 hover:bg-red-50 rounded transition-colors"
                      title="删除此组"
                    >
                      <TrashIcon />
                    </button>
                    <ChevronIcon isOpen={openCompareGroups[group.id] ?? false} />
                  </div>
                </div>

                {openCompareGroups[group.id] && (
                  <div className="px-2 pb-2">
                    {/* 子市场 */}
                    <div className="mb-2">
                      <div className="text-[10px] font-bold text-zinc-400 mb-1">子市场</div>
                      <div className="flex flex-wrap gap-1">
                        {allSubmarkets.map(s => (
                          <label key={s} className="flex items-center gap-1 text-[11px] text-zinc-600 cursor-pointer px-1.5 py-0.5 rounded border border-transparent hover:border-zinc-200 hover:bg-white transition-colors">
                            <input
                              type="checkbox"
                              checked={group.submarkets.includes(s)}
                              onChange={() => toggleGroupSubmarket(group.id, s)}
                              className="h-3.5 w-3.5 rounded border-zinc-300"
                              style={{ accentColor: group.color }}
                            />
                            <span className="truncate max-w-[60px]">{s}</span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* 等级 */}
                    <div className="mb-2">
                      <div className="text-[10px] font-bold text-zinc-400 mb-1">等级</div>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { id: '甲级', label: '甲级' },
                          { id: '乙级', label: '乙级' },
                          { id: '产业园', label: '产业园' },
                        ].map(g => (
                          <label key={g.id} className="flex items-center gap-1 text-[11px] text-zinc-600 cursor-pointer px-1.5 py-0.5 rounded border border-transparent hover:border-zinc-200 hover:bg-white transition-colors">
                            <input
                              type="checkbox"
                              checked={group.grades.includes(g.id)}
                              onChange={() => toggleGroupGrade(group.id, g.id)}
                              className="h-3.5 w-3.5 rounded border-zinc-300"
                              style={{ accentColor: group.color }}
                            />
                            {g.label}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* 行政区 */}
                    <div>
                      <div className="text-[10px] font-bold text-zinc-400 mb-1">行政区</div>
                      <div className="flex flex-wrap gap-1">
                        {districts.map(d => (
                          <label key={d} className="flex items-center gap-1 text-[11px] text-zinc-600 cursor-pointer px-1.5 py-0.5 rounded border border-transparent hover:border-zinc-200 hover:bg-white transition-colors">
                            <input
                              type="checkbox"
                              checked={group.districts.includes(d)}
                              onChange={() => toggleGroupDistrict(group.id, d)}
                              className="h-3.5 w-3.5 rounded border-zinc-300"
                              style={{ accentColor: group.color }}
                            />
                            <span className="truncate max-w-[50px]">{d}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {compareGroups.length < 5 && (
              <button
                type="button"
                onClick={addCompareGroup}
                className="w-full flex items-center justify-center py-1.5 border border-dashed border-zinc-300 rounded-md text-[11px] text-blue-600 hover:bg-blue-50 hover:border-blue-300 transition-colors font-medium"
              >
                <PlusIcon /> 添加筛选组
              </button>
            )}

            {compareGroups.length >= 5 && (
              <div className="text-[10px] text-zinc-400 text-center py-1">最多支持 5 个筛选组</div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
