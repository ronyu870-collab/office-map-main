'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Check, ChevronDown, ChevronRight, Search, SlidersHorizontal, X } from 'lucide-react';

import { PageErrorBoundary } from '@/src/components/ErrorBoundary/PageErrorBoundary';
import { fetchComparePayload } from '@/src/services/mapDataClient';

type Source = 'brochure' | 'metric' | 'building';
type Kind = 'text' | 'number' | 'percent' | 'boolean' | 'date';
type Operator = 'contains' | 'equals' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'before' | 'after' | 'yes' | 'no';

type Field = { key: string; label: string; source: Source; unit?: string; kind: Kind };
type Group = { label: string; fields: Field[] };
type Filter = { id: string; key: string; operator: Operator; value: string; valueTo?: string };
type Row = {
  id: string;
  name: string;
  grade: string;
  submarket: string;
  district: string;
  brochure: Record<string, unknown>;
  metrics: Record<string, number | null>;
  metricPeriod: string | null;
};

const f = (key: string, label: string, source: Source, unit?: string, kind: Kind = 'text'): Field => ({ key, label, source, unit, kind });

const GROUPS: Group[] = [
  { label: '项目定位', fields: [
    f('name_cn', '项目名称', 'brochure'), f('name_en', '英文名称', 'brochure'), f('developer', '开发商', 'brochure'),
    f('district', '行政区', 'building'), f('submarket', '子市场', 'building'), f('address', '地址', 'brochure'),
    f('grade', '项目等级', 'building'), f('completion_date', '竣工日期', 'brochure', undefined, 'date'),
  ] },
  { label: '市场经营数据', fields: [
    f('net_effective_rent', '净有效租金', 'metric', '元/㎡/月', 'number'), f('asking_rent', '报价租金', 'metric', '元/㎡/月', 'number'),
    f('face_rent', '表面租金', 'metric', '元/㎡/月', 'number'), f('management_fee', '物业费', 'metric', '元/㎡/月', 'number'),
    f('rent_free_period', '免租期', 'metric', '月', 'number'), f('vacancy_rate', '空置率', 'metric', '%', 'percent'),
    f('vacant_area', '空置面积', 'metric', '㎡', 'number'), f('total_area', '总面积', 'metric', '㎡', 'number'),
  ] },
  { label: '面积与规模', fields: [
    f('gfa_total', '总建筑面积', 'brochure', '㎡', 'number'), f('gfa_office', '办公面积', 'brochure', '㎡', 'number'),
    f('gfa_retail', '商业面积', 'brochure', '㎡', 'number'), f('standard_floor_area', '标准层面积', 'brochure', '㎡', 'number'),
  ] },
  { label: '建筑参数', fields: [
    f('building_height', '建筑高度', 'brochure', 'm', 'number'), f('building_floors', '总楼层', 'brochure', undefined, 'number'),
    f('floors_above', '地上层数', 'brochure', undefined, 'number'), f('floors_below', '地下层数', 'brochure', undefined, 'number'),
    f('floor_height', '层高', 'brochure', 'm', 'number'), f('clear_height', '净高', 'brochure', 'm', 'number'),
    f('raised_floor_cm', '架空地板', 'brochure', 'cm', 'number'), f('efficiency_rate', '得房率', 'brochure', '%', 'percent'),
    f('column_free', '无柱设计', 'brochure', undefined, 'boolean'), f('depth', '进深', 'brochure', 'm', 'number'),
    f('column_spacing', '柱距', 'brochure', 'm', 'number'),
  ] },
  { label: '结构与交付', fields: [
    f('floor_load_office', '办公区荷载', 'brochure', 'kg/㎡', 'number'), f('floor_load_equipment', '设备区荷载', 'brochure', 'kg/㎡', 'number'),
    f('facade_type', '幕墙类型', 'brochure'), f('delivery_standard', '交付标准', 'brochure'), f('removable_floor', '可拆卸楼板', 'brochure', undefined, 'boolean'),
  ] },
  { label: '绿色与认证', fields: [
    f('leed_certification', 'LEED 认证', 'brochure'), f('well_certification', 'WELL 认证', 'brochure'),
    f('green_building_standard', '绿色建筑标准', 'brochure'), f('green_power', '绿色电力', 'brochure', undefined, 'boolean'),
  ] },
  { label: '交通与物业', fields: [
    f('metro_access', '地铁通达', 'brochure'), f('property_management', '物业公司', 'brochure'),
    f('restrooms_per_floor', '每层卫生间', 'brochure', undefined, 'number'),
  ] },
  { label: '电梯与停车', fields: [
    f('elevator_passenger', '客梯', 'brochure', '台', 'number'), f('elevator_zones', '电梯分区', 'brochure'),
    f('elevator_vip', 'VIP 梯', 'brochure', '台', 'number'), f('elevator_freight', '货梯', 'brochure', '台', 'number'),
    f('parking_total', '总车位', 'brochure', '个', 'number'), f('parking_above', '地上车位', 'brochure', '个', 'number'),
    f('parking_underground_floor', '地下停车层', 'brochure', '层', 'number'), f('parking_underground', '地下车位', 'brochure', '个', 'number'),
    f('parking_charging', '充电桩', 'brochure', '个', 'number'),
  ] },
  { label: '机电与空调', fields: [
    f('power_system', '供电系统', 'brochure'), f('power_source', '供电来源', 'brochure'), f('power_backup_generator', '备用发电机', 'brochure'),
    f('telecom_provider', '电信运营商', 'brochure'), f('hvac_system', '空调系统', 'brochure'),
    f('hvac_fresh_air_capacity', '新风量', 'brochure', 'm³/h/人', 'number'), f('hvac_pm25_purification', 'PM2.5 净化', 'brochure', undefined, 'boolean'),
    f('hvac_hours', '空调供应时间', 'brochure'), f('hvac_cooling_water_24h', '24 小时冷却水', 'brochure', undefined, 'boolean'),
  ] },
];

const FIELDS = GROUPS.flatMap((group) => group.fields);
const FIELD_MAP = new Map(FIELDS.map((item) => [item.key, item]));
const GRADE: Record<string, string> = { P: '超甲级', A: '甲级', B: '乙级', BP: '产业园' };
const MAX_COMPETITORS = 5;

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMetric(key: string, value: unknown): number | null {
  const parsed = numeric(value);
  if (parsed === null) return null;
  // building_metrics stores vacancy_rate as a 0-1 ratio; the comparison UI uses 0-100 percent.
  return key === 'vacancy_rate' ? parsed * 100 : parsed;
}

function defaultOperator(field: Field): Operator {
  if (field.kind === 'boolean') return 'yes';
  if (field.kind === 'date') return 'after';
  if (field.kind === 'number' || field.kind === 'percent') return 'gte';
  return 'contains';
}

function Workspace() {
  const router = useRouter();
  const params = useSearchParams();
  const targetId = params.get('buildingId') || '';
  const targetName = params.get('name') || '楼宇对比';
  const [rows, setRows] = useState<Row[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(targetId ? [targetId] : []));
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<Filter[]>([]);
  const [fieldKey, setFieldKey] = useState('elevator_vip');
  const [operator, setOperator] = useState<Operator>('gte');
  const [value, setValue] = useState('1');
  const [valueTo, setValueTo] = useState('');
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [onlyPopulated, setOnlyPopulated] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const payload = await fetchComparePayload();
        if (!active) return;

        const brochures = new Map<string, Record<string, unknown>>();
        for (const raw of payload.brochures) {
          const record = raw as Record<string, unknown>;
          const buildingId = typeof record.building_id === 'string' ? record.building_id : '';
          if (buildingId && !brochures.has(buildingId)) brochures.set(buildingId, record);
        }

        const nextRows: Row[] = payload.buildings.map((item: any) => {
          const metricRows = Array.isArray(item.building_metrics) ? item.building_metrics : [];
          const latestMetric = metricRows[0] as Record<string, unknown> | undefined;
          const values: Record<string, number | null> = {};
          for (const key of ['total_area', 'asking_rent', 'management_fee', 'face_rent', 'rent_free_period', 'net_effective_rent', 'vacancy_rate', 'vacant_area']) {
            values[key] = normalizeMetric(key, latestMetric?.[key]);
          }
          const metricPeriod = latestMetric?.record_year && latestMetric?.record_quarter
            ? `${latestMetric.record_year} Q${latestMetric.record_quarter}`
            : latestMetric
              ? '最新'
              : null;

          return {
            id: item.id,
            name: item.name || '未命名楼宇',
            grade: item.grade || '',
            submarket: item.submarket || '',
            district: item.district || '',
            brochure: brochures.get(item.id) || {},
            metrics: values,
            metricPeriod,
          };
        });

        nextRows.sort((a, b) => a.id === targetId ? -1 : b.id === targetId ? 1 : a.name.localeCompare(b.name, 'zh-CN'));
        setRows(nextRows);
        setSelected((previous) => {
          const next = new Set<string>();
          if (targetId && nextRows.some((row) => row.id === targetId)) next.add(targetId);
          previous.forEach((id) => { if (nextRows.some((row) => row.id === id)) next.add(id); });
          const target = nextRows.find((row) => row.id === targetId);
          if (target && next.size <= 1) {
            nextRows
              .filter((row) => row.id !== targetId && (row.submarket === target.submarket || row.grade === target.grade))
              .slice(0, 3)
              .forEach((row) => next.add(row.id));
          }
          return next;
        });
      } catch (loadError) {
        if (!active) return;
        setRows([]);
        setError(loadError instanceof Error ? loadError.message : '楼宇对比数据加载失败');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [targetId]);

  const field = FIELD_MAP.get(fieldKey) || FIELDS[0];
  const valueFor = (row: Row, item: Field): unknown => {
    if (item.key === 'name_cn') return row.brochure.name_cn || row.name;
    if (item.source === 'metric') return row.metrics[item.key];
    if (item.source === 'building') return row[item.key as keyof Pick<Row, 'id' | 'name' | 'grade' | 'submarket' | 'district'>];
    return row.brochure[item.key];
  };

  const matches = (row: Row, filter: Filter): boolean => {
    const item = FIELD_MAP.get(filter.key);
    if (!item) return true;
    const raw = valueFor(row, item);
    if (raw === null || raw === undefined || raw === '') return false;
    if (filter.operator === 'yes') return raw === true || raw === 'true';
    if (filter.operator === 'no') return raw === false || raw === 'false';
    if (item.kind === 'number' || item.kind === 'percent') {
      const n = Number(raw), from = Number(filter.value), to = Number(filter.valueTo);
      if (!Number.isFinite(n) || !Number.isFinite(from)) return false;
      if (filter.operator === 'gt') return n > from;
      if (filter.operator === 'gte') return n >= from;
      if (filter.operator === 'lt') return n < from;
      if (filter.operator === 'lte') return n <= from;
      if (filter.operator === 'equals') return n === from;
      return Number.isFinite(to) && n >= from && n <= to;
    }
    if (item.kind === 'date') {
      const date = String(raw).slice(0, 10);
      if (filter.operator === 'before') return date <= filter.value;
      if (filter.operator === 'after') return date >= filter.value;
      if (filter.operator === 'equals') return date === filter.value;
      return Boolean(filter.valueTo) && date >= filter.value && date <= (filter.valueTo || '');
    }
    const actual = String(raw).toLocaleLowerCase();
    const expected = filter.value.toLocaleLowerCase();
    return filter.operator === 'equals' ? actual === expected : actual.includes(expected);
  };

  const candidates = rows.filter((row) => row.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && filters.every((filter) => matches(row, filter)));
  const selectedRows = useMemo(() => rows.filter((row) => selected.has(row.id)).sort((a, b) => a.id === targetId ? -1 : b.id === targetId ? 1 : a.name.localeCompare(b.name, 'zh-CN')), [rows, selected, targetId]);
  const targetSelected = Boolean(targetId && selected.has(targetId));
  const competitorCount = selectedRows.length - (targetSelected ? 1 : 0);

  const toggle = (id: string) => {
    if (id === targetId) return;
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else if (next.size - (targetId && next.has(targetId) ? 1 : 0) < MAX_COMPETITORS) next.add(id);
      return next;
    });
  };

  const addFilter = () => {
    if (field.kind !== 'boolean' && !value.trim()) return;
    if (operator === 'between' && !valueTo.trim()) return;
    setFilters((current) => [...current, { id: crypto.randomUUID(), key: field.key, operator, value: value.trim(), valueTo: valueTo.trim() || undefined }]);
    setValue('');
    setValueTo('');
  };

  const visible = (item: Field) => {
    const present = selectedRows.map((row) => valueFor(row, item)).filter((v) => v !== null && v !== undefined && v !== '');
    if (onlyPopulated && present.length === 0) return false;
    if (!onlyDifferences) return true;
    return !(present.length === selectedRows.length && new Set(present.map(String)).size <= 1);
  };

  const format = (raw: unknown, item: Field) => {
    if (raw === null || raw === undefined || raw === '') return '未提供';
    if (item.key === 'grade') return GRADE[String(raw)] || String(raw);
    if (item.kind === 'boolean') return raw === true || raw === 'true' ? '是' : raw === false || raw === 'false' ? '否' : String(raw);
    if (item.kind === 'percent') return `${Number(raw).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
    if (item.kind === 'number') return Number(raw).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    return String(raw);
  };

  const operatorOptions = field.kind === 'boolean'
    ? [['yes', '有'], ['no', '无']]
    : field.kind === 'number' || field.kind === 'percent'
      ? [['gt', '大于'], ['gte', '大于等于'], ['lt', '小于'], ['lte', '小于等于'], ['equals', '等于'], ['between', '区间']]
      : field.kind === 'date'
        ? [['after', '不早于'], ['before', '不晚于'], ['equals', '等于'], ['between', '区间']]
        : [['contains', '包含'], ['equals', '等于']];

  return <div className="flex h-screen h-[100dvh] min-h-0 flex-col bg-zinc-50">
    <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-5 py-3 shadow-sm">
      <button type="button" onClick={() => router.push('/map')} className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"><ArrowLeft size={16} />返回地图</button>
      <span className="text-zinc-300">|</span><h1 className="text-sm font-semibold text-zinc-800">楼宇对比</h1>
      <span className="truncate text-xs text-zinc-400">{targetName}</span>
      <span className="ml-auto text-xs text-zinc-400">已选 {competitorCount} / {MAX_COMPETITORS} 个竞品</span>
    </header>

    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-[280px] shrink-0 flex-col border-r border-zinc-200 bg-white">
        <div className="border-b border-zinc-100 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700"><SlidersHorizontal size={15} className="text-[#003e7e]" />选择对比项目</div>
          <div className="relative"><Search size={14} className="absolute left-2.5 top-2 text-zinc-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索项目名称" className="w-full rounded border border-zinc-200 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[#003e7e]" /></div>
          <div className="mt-3 border-t border-zinc-100 pt-3">
            <p className="mb-2 text-[11px] font-medium text-zinc-600">按指标筛选 <span className="font-normal text-zinc-400">（条件同时满足）</span></p>
            <select value={fieldKey} onChange={(e) => { const next = FIELD_MAP.get(e.target.value); setFieldKey(e.target.value); if (next) setOperator(defaultOperator(next)); setValue(''); setValueTo(''); }} className="mb-2 w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-[11px]">
              {GROUPS.map((group) => <optgroup key={group.label} label={group.label}>{group.fields.map((item) => <option key={item.key} value={item.key}>{item.label}{item.unit ? ` (${item.unit})` : ''}</option>)}</optgroup>)}
            </select>
            <div className="grid grid-cols-[92px_1fr] gap-2">
              <select value={operator} onChange={(e) => setOperator(e.target.value as Operator)} className="rounded border border-zinc-200 bg-white px-1.5 py-1.5 text-[11px]">{operatorOptions.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
              {field.kind !== 'boolean' ? <input type={field.kind === 'date' ? 'date' : field.kind === 'number' || field.kind === 'percent' ? 'number' : 'text'} value={value} onChange={(e) => setValue(e.target.value)} placeholder={field.kind === 'text' ? '输入关键词' : '数值'} className="min-w-0 rounded border border-zinc-200 px-2 py-1.5 text-[11px] outline-none focus:border-[#003e7e]" /> : <div />}
            </div>
            {operator === 'between' ? <input type={field.kind === 'date' ? 'date' : 'number'} value={valueTo} onChange={(e) => setValueTo(e.target.value)} placeholder="上限" className="mt-2 w-full rounded border border-zinc-200 px-2 py-1.5 text-[11px]" /> : null}
            <button type="button" onClick={addFilter} disabled={field.kind !== 'boolean' && (!value || (operator === 'between' && !valueTo))} className="mt-2 w-full rounded bg-[#003e7e] px-2 py-1.5 text-[11px] font-medium text-white hover:bg-[#002d5c] disabled:cursor-not-allowed disabled:bg-zinc-300">添加条件</button>
            {filters.length ? <div className="mt-2 flex flex-wrap gap-1">{filters.map((filter) => <span key={filter.id} className="inline-flex items-center gap-1 rounded bg-blue-50 px-1.5 py-1 text-[10px] text-[#003e7e]">{FIELD_MAP.get(filter.key)?.label}<button type="button" onClick={() => setFilters((current) => current.filter((item) => item.id !== filter.id))} aria-label="删除筛选条件"><X size={11} /></button></span>)}</div> : null}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-2">
          {error ? <div className="m-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div> : null}
          {candidates.map((row) => { const checked = selected.has(row.id); const target = row.id === targetId; return <button key={row.id} type="button" onClick={() => toggle(row.id)} className={`mb-1 flex w-full items-start gap-2 rounded px-2.5 py-2 text-left ${checked ? 'bg-blue-50' : 'hover:bg-zinc-50'}`}>
            <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-[#003e7e] bg-[#003e7e] text-white' : 'border-zinc-300'}`}>{checked ? <Check size={11} /> : null}</span>
            <span className="min-w-0"><span className={`block truncate text-xs font-medium ${target ? 'text-[#003e7e]' : 'text-zinc-700'}`}>{row.name}{target ? <span className="ml-1 text-[10px]">当前</span> : null}</span><span className="block truncate text-[10px] text-zinc-400">{GRADE[row.grade] || row.grade || '未分级'}{row.submarket ? ` · ${row.submarket}` : ''}</span></span>
          </button>; })}
          {!loading && !error && !candidates.length ? <p className="p-4 text-center text-xs text-zinc-400">没有匹配项目</p> : null}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-5 py-2.5 text-xs text-zinc-500">
          <span>最多选择 5 个竞品，可横向逐项比较。</span>
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={onlyDifferences} onChange={(e) => setOnlyDifferences(e.target.checked)} className="accent-[#003e7e]" />仅看差异</label>
          <label className="flex cursor-pointer items-center gap-1.5"><input type="checkbox" checked={onlyPopulated} onChange={(e) => setOnlyPopulated(e.target.checked)} className="accent-[#003e7e]" />隐藏空指标</label>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? <div className="flex justify-center py-20"><div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" /></div> : !selectedRows.length ? <div className="p-12 text-center text-sm text-zinc-400">请选择至少一个项目</div> : <table className="min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-20 bg-zinc-50 shadow-sm"><tr className="border-b-2 border-zinc-200"><th className="sticky left-0 z-30 min-w-[180px] bg-zinc-50 px-4 py-3 text-left font-semibold text-zinc-500">对比指标</th>{selectedRows.map((row) => <th key={row.id} className={`min-w-[180px] border-l border-zinc-100 px-4 py-2.5 text-left ${row.id === targetId ? 'bg-blue-50' : 'bg-zinc-50'}`}><div className={`font-semibold ${row.id === targetId ? 'text-[#003e7e]' : 'text-zinc-700'}`}>{row.name}</div><div className="mt-1 font-normal text-[10px] text-zinc-400">{GRADE[row.grade] || row.grade || '未分级'}{row.submarket ? ` · ${row.submarket}` : ''}{row.metricPeriod ? ` · 经营数据 ${row.metricPeriod}` : ''}</div></th>)}</tr></thead>
            <tbody>{GROUPS.map((group) => { const fields = group.fields.filter(visible); if (!fields.length) return null; const closed = collapsed.has(group.label); return <React.Fragment key={group.label}><tr className="border-y border-zinc-200 bg-zinc-100"><td colSpan={selectedRows.length + 1} className="sticky left-0 cursor-pointer px-3 py-2 font-semibold text-[#003e7e]" onClick={() => setCollapsed((current) => { const next = new Set(current); if (next.has(group.label)) next.delete(group.label); else next.add(group.label); return next; })}>{closed ? <ChevronRight size={14} className="mr-1 inline" /> : <ChevronDown size={14} className="mr-1 inline" />}{group.label}<span className="ml-2 text-[10px] font-normal text-zinc-400">{fields.length} 项</span></td></tr>{!closed ? fields.map((item) => <tr key={item.key} className="border-b border-zinc-100 hover:bg-zinc-50"><td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-zinc-600">{item.label}{item.unit ? <span className="ml-1 text-[10px] font-normal text-zinc-400">({item.unit})</span> : null}</td>{selectedRows.map((row) => { const raw = valueFor(row, item); const missing = raw === null || raw === undefined || raw === ''; return <td key={row.id} className={`border-l border-zinc-100 px-4 py-2.5 ${row.id === targetId ? 'bg-blue-50/30 font-medium text-[#003e7e]' : 'text-zinc-700'} ${missing ? 'text-zinc-300' : ''}`}>{format(raw, item)}</td>; })}</tr>) : null}</React.Fragment>; })}</tbody>
          </table>}
        </div>
      </main>
    </div>
  </div>;
}

export default function BuildingCompareWorkspace() {
  return <PageErrorBoundary pageName="楼宇对比"><Workspace /></PageErrorBoundary>;
}
