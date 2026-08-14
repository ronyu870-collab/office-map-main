'use client';

import * as React from 'react';
import type { SidebarFilterState, NumericCondition } from '@/src/components/SidebarFilter';

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
  { value: '<', label: '<' },
];

interface DebugFilterProps {
  districts: string[];
  submarkets: string[];
  leeds: string[];
  onFilterChange: (state: SidebarFilterState) => void;
}

export function DebugFilter({ districts, submarkets, leeds, onFilterChange }: DebugFilterProps) {
  const [openSections, setOpenSections] = React.useState<Record<string, boolean>>({
    projectTypes: true, districts: false, submarkets: false, leeds: false, numeric: false,
  });
  const toggleSection = (key: string) => setOpenSections(p => ({ ...p, [key]: !p[key] }));

  const [state, setState] = React.useState<SidebarFilterState>({
    districts: [...districts],
    submarkets: [...submarkets],
    leeds: [...leeds],
    projectTypes: ['甲级写字楼', '乙级写字楼', '产业园区'],
    showBoundaries: false,
    subwayLine: null,
    subwayStation: null,
    subwayDistance: null,
    numericFilters: [],
    showFutureSupply: false,
    futureSupplyGrades: [],
    futureSupplyYears: [],
  });

  const onFilterChangeRef = React.useRef(onFilterChange);
  React.useEffect(() => { onFilterChangeRef.current = onFilterChange; }, [onFilterChange]);
  React.useEffect(() => { onFilterChangeRef.current(state); }, [state]);

  const toggle = (field: 'districts' | 'submarkets' | 'leeds', val: string) => {
    setState(prev => {
      const set = new Set(prev[field] || []);
      set.has(val) ? set.delete(val) : set.add(val);
      return { ...prev, [field]: Array.from(set) };
    });
  };
  const toggleAll = (field: 'districts' | 'submarkets' | 'leeds', allVals: string[], select: boolean) => {
    setState(prev => ({ ...prev, [field]: select ? [...allVals] : [] }));
  };

  const addNumericFilter = () => {
    setState(p => ({
      ...p,
      numericFilters: [...(p.numericFilters || []), { id: Date.now().toString(), field: 'net_effective_rent', operator: '>=', value: '' }],
    }));
  };
  const removeNumericFilter = (id: string) => {
    setState(p => ({ ...p, numericFilters: (p.numericFilters || []).filter(f => f.id !== id) }));
  };
  const updateNumericFilter = (id: string, key: keyof NumericCondition, val: any) => {
    setState(p => ({
      ...p,
      numericFilters: (p.numericFilters || []).map(f => (f.id === id ? { ...f, [key]: val } : f)),
    }));
  };

  const ChevronIcon = ({ isOpen }: { isOpen: boolean }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-200 ${isOpen ? 'rotate-180 text-blue-600' : 'text-zinc-400'}`}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );

  const TrashIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-500 hover:text-red-700 transition-colors">
      <path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );

  const SectionHeader = ({ label, sectionKey }: { label: string; sectionKey: string }) => (
    <div className="flex items-center justify-between cursor-pointer py-2 px-1 rounded-md hover:bg-zinc-50 transition-colors" onClick={() => toggleSection(sectionKey)}>
      <div className="text-[12px] font-semibold text-zinc-800">{label}</div>
      <ChevronIcon isOpen={openSections[sectionKey]} />
    </div>
  );

  return (
    <aside className="w-[280px] shrink-0 border-r border-zinc-200 bg-white overflow-y-auto">
      <div className="px-3 py-3">
        <h3 className="text-sm font-bold text-zinc-800 mb-3">数据筛选</h3>

        {/* 项目类型 */}
        <section className="mb-1">
          <SectionHeader label="项目类型" sectionKey="projectTypes" />
          {openSections.projectTypes && (
            <div className="mt-1 mb-3 px-1">
              <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                <input type="checkbox" checked={state.projectTypes.length === 3}
                  ref={el => { if (el) el.indeterminate = state.projectTypes.length > 0 && state.projectTypes.length < 3; }}
                  onChange={e => setState(p => ({ ...p, projectTypes: e.target.checked ? ['甲级写字楼', '乙级写字楼', '产业园区'] : [] }))}
                  className="h-4 w-4 rounded border-zinc-300 text-primary transition-colors" /> 全选
              </label>
              <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                {['甲级写字楼', '乙级写字楼', '产业园区'].map(pt => (
                  <label key={pt} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                    <input type="checkbox" checked={state.projectTypes.includes(pt)}
                      onChange={() => setState(prev => { const s = new Set(prev.projectTypes); s.has(pt) ? s.delete(pt) : s.add(pt); return { ...prev, projectTypes: Array.from(s) }; })}
                      className="h-4 w-4 rounded border-zinc-300 text-blue-700" />
                    <span className="truncate text-[11px] text-zinc-700">{pt}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 行政区 */}
        <section className="mb-1 border-t border-zinc-100 pt-1">
          <SectionHeader label="行政区" sectionKey="districts" />
          {openSections.districts && (
            <div className="mt-1 mb-3 px-1">
              <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                <input type="checkbox" checked={state.districts.length === districts.length}
                  ref={el => { if (el) el.indeterminate = state.districts.length > 0 && state.districts.length < districts.length; }}
                  onChange={e => toggleAll('districts', districts, e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-700" /> 全选
              </label>
              <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                {districts.map(d => (
                  <label key={d} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                    <input type="checkbox" checked={state.districts.includes(d)}
                      onChange={() => toggle('districts', d)}
                      className="h-4 w-4 rounded border-zinc-300 text-blue-700" />
                    <span className="truncate text-[11px] text-zinc-700">{d}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 子市场 */}
        <section className="mb-1 border-t border-zinc-100 pt-1">
          <SectionHeader label="子市场" sectionKey="submarkets" />
          {openSections.submarkets && (
            <div className="mt-1 mb-3 px-1">
              <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                <input type="checkbox" checked={state.submarkets.length === submarkets.length}
                  ref={el => { if (el) el.indeterminate = state.submarkets.length > 0 && state.submarkets.length < submarkets.length; }}
                  onChange={e => toggleAll('submarkets', submarkets, e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-700" /> 全选
              </label>
              <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                {submarkets.map(s => (
                  <label key={s} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                    <input type="checkbox" checked={state.submarkets.includes(s)}
                      onChange={() => toggle('submarkets', s)}
                      className="h-4 w-4 rounded border-zinc-300 text-blue-700" />
                    <span className="truncate text-[11px] text-zinc-700">{s}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* LEED */}
        <section className="mb-1 border-t border-zinc-100 pt-1">
          <SectionHeader label="LEED认证" sectionKey="leeds" />
          {openSections.leeds && (
            <div className="mt-1 mb-3 px-1">
              <label className="flex items-center gap-2 mb-2 text-[11px] font-medium text-zinc-600 cursor-pointer">
                <input type="checkbox" checked={state.leeds.length === leeds.length}
                  ref={el => { if (el) el.indeterminate = state.leeds.length > 0 && state.leeds.length < leeds.length; }}
                  onChange={e => toggleAll('leeds', leeds, e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300 text-blue-700" /> 全选
              </label>
              <div className="grid gap-x-0 gap-y-2" style={{ gridTemplateColumns: 'auto auto', justifyContent: 'start' }}>
                {leeds.map(l => (
                  <label key={l} className="flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 hover:border-zinc-200 hover:bg-zinc-50 cursor-pointer">
                    <input type="checkbox" checked={state.leeds.includes(l)}
                      onChange={() => toggle('leeds', l)}
                      className="h-4 w-4 rounded border-zinc-300 text-blue-700" />
                    <span className="truncate text-[11px] text-zinc-700">{l === 'NULL' ? '无' : l}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 多重筛选 */}
        <section className="mb-1 border-t border-zinc-100 pt-1">
          <SectionHeader label="多重筛选" sectionKey="numeric" />
          {openSections.numeric && (
            <div className="mt-1 mb-2 px-1">
              <div className="flex flex-col gap-2 mb-2">
                {(state.numericFilters || []).map(filter => {
                  const isText = TEXT_FIELDS.has(filter.field);
                  return (
                    <div key={filter.id} className="flex items-center gap-1.5">
                      <select className="flex-1 text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 min-w-[70px] outline-none"
                        value={filter.field} onChange={e => updateNumericFilter(filter.id, 'field', e.target.value)}>
                        {NUMERIC_FIELDS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                      {isText ? (
                        <span className="text-[11px] px-1 text-zinc-400 w-[42px] text-center">含</span>
                      ) : (
                        <select className="text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 w-[42px] outline-none text-center"
                          value={filter.operator} onChange={e => updateNumericFilter(filter.id, 'operator', e.target.value)}>
                          {NUMERIC_OPERATORS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      )}
                      {isText ? (
                        <input type="text" placeholder="模糊搜索"
                          className="flex-1 text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 min-w-[50px] outline-none"
                          value={filter.value} onChange={e => updateNumericFilter(filter.id, 'value', e.target.value)} />
                      ) : (
                        <input type="number" placeholder="数值"
                          className="flex-1 text-[11px] p-1 border border-zinc-200 rounded bg-zinc-50 text-zinc-700 min-w-[50px] outline-none"
                          value={filter.value} onChange={e => updateNumericFilter(filter.id, 'value', e.target.value ? Number(e.target.value) : '')} />
                      )}
                      <button type="button" onClick={() => removeNumericFilter(filter.id)}
                        className="p-1.5 flex items-center justify-center hover:bg-red-50 rounded transition-colors shrink-0" title="删除条件">
                        <TrashIcon />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button onClick={addNumericFilter}
                className="w-full text-[11px] py-1.5 border border-dashed border-zinc-300 rounded-md text-zinc-500 hover:border-primary hover:text-primary hover:bg-primary/5 transition-all">
                + 添加筛选条件
              </button>
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
