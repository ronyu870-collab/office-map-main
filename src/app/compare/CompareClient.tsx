'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';

import { PageErrorBoundary } from '@/src/components/ErrorBoundary/PageErrorBoundary';
import { supabase } from '@/src/services/supabaseClient';

type ValueSource = 'brochure' | 'metric' | 'building';
type FieldType = 'number' | 'percent' | 'boolean' | 'date' | 'text';
type FilterOperator =
  | 'contains'
  | 'equals'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'before'
  | 'after'
  | 'yes'
  | 'no';

interface CompareField {
  key: string;
  label: string;
  source: ValueSource;
  unit?: string;
  type?: FieldType;
}

interface FieldGroup {
  label: string;
  fields: CompareField[];
}

interface BuildingInfo {
  id: string;
  name: string;
  grade: string;
  submarket: string;
  district: string;
}

interface CompareRow extends BuildingInfo {
  brochure: Record<string, unknown>;
  metrics: Record<string, number | null>;
  metricPeriod: string | null;
}

interface MetricFilter {
  id: string;
  fieldKey: string;
  operator: FilterOperator;
  value: string;
  valueTo?: string;
}

const field = (
  key: string,
  label: string,
  source: ValueSource,
  unit?: string,
  type: FieldType = 'text',
): CompareField => ({ key, label, source, unit, type });

const FIELD_GROUPS: FieldGroup[] = [
  {
    label: '项目定位',
    fields: [
      field('name_cn', '项目名称', 'brochure'),
      field('name_en', '英文名称', 'brochure'),
      field('developer', '开发商', 'brochure'),
      field('district', '行政区', 'building'),
      field('submarket', '子市场', 'building'),
      field('address', '地址', 'brochure'),
      field('grade', '项目等级', 'building'),
      field('completion_date', '竣工日期', 'brochure', undefined, 'date'),
    ],
  },
  {
    label: '市场经营数据',
    fields: [
      field('net_effective_rent', '净有效租金', 'metric', '元/㎡/月', 'number'),
      field('asking_rent', '报价租金', 'metric', '元/㎡/月', 'number'),
      field('face_rent', '表面租金', 'metric', '元/㎡/月', 'number'),
      field('management_fee', '物业费', 'metric', '元/㎡/月', 'number'),
      field('rent_free_period', '免租期', 'metric', '月', 'number'),
      field('vacancy_rate', '空置率', 'metric', '%', 'percent'),
      field('vacant_area', '空置面积', 'metric', '㎡', 'number'),
      field('total_area', '总面积', 'metric', '㎡', 'number'),
    ],
  },
  {
    label: '面积与规模',
    fields: [
      field('gfa_total', '总建筑面积', 'brochure', '㎡', 'number'),
      field('gfa_office', '办公面积', 'brochure', '㎡', 'number'),
      field('gfa_retail', '商业面积', 'brochure', '㎡', 'number'),
      field('standard_floor_area', '标准层面积', 'brochure', '㎡', 'number'),
    ],
  },
  {
    label: '建筑参数',
    fields: [
      field('building_height', '建筑高度', 'brochure', 'm', 'number'),
      field('building_floors', '总楼层', 'brochure', undefined, 'number'),
      field('floors_above', '地上层数', 'brochure', undefined, 'number'),
      field('floors_below', '地下层数', 'brochure', undefined, 'number'),
      field('floor_height', '层高', 'brochure', 'm', 'number'),
      field('clear_height', '净高', 'brochure', 'm', 'number'),
      field('raised_floor_cm', '架空地板', 'brochure', 'cm', 'number'),
      field('efficiency_rate', '得房率', 'brochure', '%', 'percent'),
      field('column_free', '无柱设计', 'brochure', undefined, 'boolean'),
      field('depth', '进深', 'brochure', 'm', 'number'),
      field('column_spacing', '柱距', 'brochure', 'm', 'number'),
    ],
  },
  {
    label: '结构与交付',
    fields: [
      field('floor_load_office', '办公区荷载', 'brochure', 'kg/㎡', 'number'),
      field('floor_load_equipment', '设备区荷载', 'brochure', 'kg/㎡', 'number'),
      field('facade_type', '幕墙类型', 'brochure'),
      field('delivery_standard', '交付标准', 'brochure'),
      field('removable_floor', '可拆卸楼板', 'brochure', undefined, 'boolean'),
    ],
  },
  {
    label: '绿色与认证',
    fields: [
      field('leed_certification', 'LEED 认证', 'brochure'),
      field('well_certification', 'WELL 认证', 'brochure'),
      field('green_building_standard', '绿色建筑标准', 'brochure'),
      field('green_power', '绿色电力', 'brochure', undefined, 'boolean'),
    ],
  },
  {
    label: '交通与物业',
    fields: [
      field('metro_access', '地铁通达', 'brochure'),
      field('property_management', '物业公司', 'brochure'),
      field('restrooms_per_floor', '每层卫生间', 'brochure', undefined, 'number'),
    ],
  },
  {
    label: '电梯与停车',
    fields: [
      field('elevator_passenger', '客梯', 'brochure', '台', 'number'),
      field('elevator_zones', '电梯分区', 'brochure'),
      field('elevator_vip', 'VIP 梯', 'brochure', '台', 'number'),
      field('elevator_freight', '货梯', 'brochure', '台', 'number'),
      field('parking_total', '总车位', 'brochure', '个', 'number'),
      field('parking_above', '地上车位', 'brochure', '个', 'number'),
      field('parking_underground_floor', '地下停车层', 'brochure', '层', 'number'),
      field('parking_underground', '地下车位', 'brochure', '个', 'number'),
      field('parking_charging', '充电桩', 'brochure', '个', 'number'),
    ],
  },
  {
    label: '机电与空调',
    fields: [
      field('power_system', '供电系统', 'brochure'),
      field('power_source', '供电来源', 'brochure'),
      field('power_backup_generator', '备用发电机', 'brochure'),
      field('telecom_provider', '电信运营商', 'brochure'),
      field('hvac_system', '空调系统', 'brochure'),
      field('hvac_fresh_air_capacity', '新风量', 'brochure', 'm³/h/人', 'number'),
      field('hvac_pm25_purification', 'PM2.5 净化', 'brochure', undefined, 'boolean'),
      field('hvac_hours', '空调供应时间', 'brochure'),
      field('hvac_cooling_water_24h', '24 小时冷却水', 'brochure', undefined, 'boolean'),
    ],
  },
];

const GRADE_LABEL: Record<string, string> = {
  A: '甲级',
  P: '超甲级',
  B: '乙级',
  BP: '产业园',
};
const MAX_COMPETITORS = 5;
const FILTERABLE_FIELDS = FIELD_GROUPS.flatMap((group) =>
  group.fields.map((item) => ({ ...item, group: group.label })),
);
const FIELD_BY_KEY = new Map(FILTERABLE_FIELDS.map((item) => [item.key, item]));

const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const defaultOperator = (item: CompareField): FilterOperator => {
  if (item.type === 'boolean') return 'yes';
  if (item.type === 'date') return 'after';
  if (item.type === 'number' || item.type === 'percent') return 'gte';
  return 'contains';
};

function CompareClientContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetBuildingId = searchParams.get('buildingId') || '';
  const targetName = searchParams.get('name') || '楼宇对比';

  const [allRows, setAllRows] = useState<CompareRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    new Set(targetBuildingId ? [targetBuildingId] : []),
  );
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<MetricFilter[]>([]);
  const [draftFieldKey, setDraftFieldKey] = useState('elevator_vip');
  const [draftOperator, setDraftOperator] = useState<FilterOperator>('gte');
  const [draftValue, setDraftValue] = useState('1');
  const [draftValueTo, setDraftValueTo] = useState('');
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [onlyPopulated, setOnlyPopulated] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      setLoading(true);
      setLoadError(null);

      const [brochureResult, buildingResult, metricResult] = await Promise.all([
        supabase
          .from('building_brochure_data')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(3000),
        supabase
          .from('buildings')
          .select('id, name, grade, submarket, district')
          .order('name', { ascending: true })
          .limit(3000),
        supabase
          .from('building_metrics')
          .select(
            'building_id, record_year, record_quarter, created_at, total_area, asking_rent, management_fee, face_rent, rent_free_period, net_effective_rent, vacancy_rate, vacant_area',
          )
          .order('record_year', { ascending: false })
          .order('record_quarter', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(5000),
      ]);

      if (cancelled) return;

      const firstError = brochureResult.error || buildingResult.error || metricResult.error;
      if (firstError) {
        setLoadError(firstError.message || '楼宇对比数据加载失败');
        setAllRows([]);
        setLoading(false);
        return;
      }

      const brochureByBuilding = new Map<string, Record<string, unknown>>();
      for (const rawRow of brochureResult.data || []) {
        const row = rawRow as Record<string, unknown>;
        const buildingId = typeof row.building_id === 'string' ? row.building_id : '';
        if (buildingId && !brochureByBuilding.has(buildingId)) {
          brochureByBuilding.set(buildingId, row);
        }
      }

      const metricByBuilding = new Map<
        string,
        { values: Record<string, number | null>; period: string }
      >();
      for (const item of metricResult.data || []) {
        if (!item.building_id || metricByBuilding.has(item.building_id)) continue;
        metricByBuilding.set(item.building_id, {
          values: {
            total_area: toNumberOrNull(item.total_area),
            asking_rent: toNumberOrNull(item.asking_rent),
            management_fee: toNumberOrNull(item.management_fee),
            face_rent: toNumberOrNull(item.face_rent),
            rent_free_period: toNumberOrNull(item.rent_free_period),
            net_effective_rent: toNumberOrNull(item.net_effective_rent),
            vacancy_rate: toNumberOrNull(item.vacancy_rate),
            vacant_area: toNumberOrNull(item.vacant_area),
          },
          period:
            item.record_year && item.record_quarter
              ? `${item.record_year} Q${item.record_quarter}`
              : '最新',
        });
      }

      const rows: CompareRow[] = (buildingResult.data || []).map((item) => ({
        id: item.id,
        name: item.name || '未命名楼宇',
        grade: item.grade || '',
        submarket: item.submarket || '',
        district: item.district || '',
        brochure: brochureByBuilding.get(item.id) || {},
        metrics: metricByBuilding.get(item.id)?.values || {},
        metricPeriod: metricByBuilding.get(item.id)?.period || null,
      }));

      rows.sort((a, b) =>
        a.id === targetBuildingId
          ? -1
          : b.id === targetBuildingId
            ? 1
            : a.name.localeCompare(b.name, 'zh-CN'),
      );

      setAllRows(rows);
      setSelectedIds((previous) => {
        const next = new Set<string>();
        if (targetBuildingId && rows.some((row) => row.id === targetBuildingId)) {
          next.add(targetBuildingId);
        }
        previous.forEach((id) => {
          if (rows.some((row) => row.id === id)) next.add(id);
        });
        const target = rows.find((row) => row.id === targetBuildingId);
        const recommendations = rows
          .filter(
            (row) =>
              row.id !== targetBuildingId &&
              (!target || row.submarket === target.submarket || row.grade === target.grade),
          )
          .slice(0, 3);
        if (next.size === 0 || targetBuildingId) {
          recommendations.forEach((row) => next.add(row.id));
        }
        return next;
      });
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [targetBuildingId]);

  const selectedRows = useMemo(
    () =>
      allRows
        .filter((row) => selectedIds.has(row.id))
        .sort((a, b) =>
          a.id === targetBuildingId
            ? -1
            : b.id === targetBuildingId
              ? 1
              : a.name.localeCompare(b.name, 'zh-CN'),
        ),
    [allRows, selectedIds, targetBuildingId],
  );

  const valueFor = (row: CompareRow, item: CompareField): unknown => {
    if (item.key === 'name_cn') return row.brochure.name_cn || row.name;
    if (item.source === 'metric') return row.metrics[item.key];
    if (item.source === 'building') return row[item.key as keyof BuildingInfo];
    return row.brochure[item.key];
  };

  const matchesFilter = (row: CompareRow, filter: MetricFilter) => {
    const item = FIELD_BY_KEY.get(filter.fieldKey);
    if (!item) return true;
    const rawValue = valueFor(row, item);
    if (rawValue === null || rawValue === undefined || rawValue === '') return false;

    if (filter.operator === 'yes') return rawValue === true || rawValue === 'true';
    if (filter.operator === 'no') return rawValue === false || rawValue === 'false';

    if (item.type === 'number' || item.type === 'percent') {
      const value = Number(rawValue);
      const from = Number(filter.value);
      const to = Number(filter.valueTo);
      if (!Number.isFinite(value) || !Number.isFinite(from)) return false;
      if (filter.operator === 'gt') return value > from;
      if (filter.operator === 'gte') return value >= from;
      if (filter.operator === 'lt') return value < from;
      if (filter.operator === 'lte') return value <= from;
      if (filter.operator === 'equals') return value === from;
      return Number.isFinite(to) && value >= from && value <= to;
    }

    if (item.type === 'date') {
      const value = String(rawValue).slice(0, 10);
      if (filter.operator === 'before') return value <= filter.value;
      if (filter.operator === 'after') return value >= filter.value;
      if (filter.operator === 'equals') return value === filter.value;
      return Boolean(filter.valueTo) && value >= filter.value && value <= filter.valueTo!;
    }

    const value = String(rawValue).toLocaleLowerCase();
    const expected = filter.value.toLocaleLowerCase();
    return filter.operator === 'equals' ? value === expected : value.includes(expected);
  };

  const candidates = allRows.filter(
    (row) =>
      row.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      filters.every((filter) => matchesFilter(row, filter)),
  );
  const draftField = FIELD_BY_KEY.get(draftFieldKey) || FILTERABLE_FIELDS[0];

  const addFilter = () => {
    if (
      !draftField ||
      (draftField.type !== 'boolean' && !draftValue.trim()) ||
      (draftOperator === 'between' && !draftValueTo.trim())
    ) {
      return;
    }
    setFilters((previous) => [
      ...previous,
      {
        id: `${Date.now()}-${Math.random()}`,
        fieldKey: draftField.key,
        operator: draftOperator,
        value: draftValue.trim(),
        valueTo: draftValueTo.trim() || undefined,
      },
    ]);
    setDraftValue('');
    setDraftValueTo('');
  };

  const filterDescription = (filter: MetricFilter) => {
    const item = FIELD_BY_KEY.get(filter.fieldKey);
    if (!item) return '';
    const symbols: Record<FilterOperator, string> = {
      contains: '包含',
      equals: '等于',
      gt: '>',
      gte: '≥',
      lt: '<',
      lte: '≤',
      between: '介于',
      before: '不晚于',
      after: '不早于',
      yes: '有',
      no: '无',
    };
    const suffix = item.unit ? ` ${item.unit}` : '';
    if (filter.operator === 'yes' || filter.operator === 'no') {
      return `${item.label}${symbols[filter.operator]}`;
    }
    return `${item.label} ${symbols[filter.operator]} ${filter.value}${
      filter.operator === 'between' ? ` — ${filter.valueTo}` : ''
    }${suffix}`;
  };

  const formatValue = (value: unknown, item: CompareField) => {
    if (value === null || value === undefined || value === '') return '未提供';
    if (item.key === 'grade') return GRADE_LABEL[String(value)] || String(value);
    if (item.type === 'boolean') {
      if (value === true || value === 'true') return '是';
      if (value === false || value === 'false') return '否';
      return String(value);
    }
    if (item.type === 'percent') {
      return `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}%`;
    }
    if (item.type === 'number') {
      return Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    }
    return String(value);
  };

  const isVisible = (item: CompareField) => {
    const values = selectedRows
      .map((row) => valueFor(row, item))
      .filter((value) => value !== null && value !== undefined && value !== '')
      .map(String);
    if (onlyPopulated && values.length === 0) return false;
    return !(
      onlyDifferences &&
      new Set(values).size <= 1 &&
      values.length === selectedRows.length
    );
  };

  const toggleProject = (id: string) => {
    if (id === targetBuildingId) return;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(id)) {
        next.delete(id);
      } else {
        const competitorCount = next.size - (targetBuildingId && next.has(targetBuildingId) ? 1 : 0);
        if (competitorCount < MAX_COMPETITORS) next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="flex h-screen h-[100dvh] min-h-0 flex-col bg-zinc-50">
      <header className="flex shrink-0 items-center gap-3 border-b border-zinc-200 bg-white px-5 py-3 shadow-sm">
        <button
          type="button"
          onClick={() => router.push('/map')}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800"
        >
          <ArrowLeft size={16} />
          返回地图
        </button>
        <span className="text-zinc-300">|</span>
        <h1 className="text-sm font-semibold text-zinc-800">楼宇对比</h1>
        <span className="truncate text-xs text-zinc-400">{targetName}</span>
        <span className="ml-auto text-xs text-zinc-400">
          已选 {Math.max(0, selectedRows.length - (targetBuildingId ? 1 : 0))} / {MAX_COMPETITORS} 个竞品
        </span>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-[280px] shrink-0 flex-col border-r border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-zinc-700">
              <SlidersHorizontal size={15} className="text-[#003e7e]" />
              选择对比项目
            </div>
            <div className="relative mb-2">
              <Search size={14} className="absolute left-2.5 top-2 text-zinc-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索项目名称"
                className="w-full rounded border border-zinc-200 py-1.5 pl-8 pr-2 text-xs outline-none focus:border-[#003e7e]"
              />
            </div>

            <div className="mt-3 border-t border-zinc-100 pt-3">
              <p className="mb-2 text-[11px] font-medium text-zinc-600">
                按指标筛选 <span className="font-normal text-zinc-400">（条件同时满足）</span>
              </p>
              <select
                value={draftFieldKey}
                onChange={(event) => {
                  const item = FIELD_BY_KEY.get(event.target.value);
                  setDraftFieldKey(event.target.value);
                  if (item) {
                    setDraftOperator(defaultOperator(item));
                    setDraftValue('');
                    setDraftValueTo('');
                  }
                }}
                className="mb-2 w-full rounded border border-zinc-200 bg-white px-2 py-1.5 text-[11px]"
              >
                {FIELD_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.fields.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.label}{item.unit ? ` (${item.unit})` : ''}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {draftField.type === 'boolean' ? (
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={draftOperator}
                    onChange={(event) => setDraftOperator(event.target.value as FilterOperator)}
                    className="rounded border border-zinc-200 bg-white px-2 py-1.5 text-[11px]"
                  >
                    <option value="yes">有</option>
                    <option value="no">无</option>
                  </select>
                  <button
                    type="button"
                    onClick={addFilter}
                    className="rounded bg-[#003e7e] px-2 py-1.5 text-[11px] font-medium text-white hover:bg-[#002d5c]"
                  >
                    添加条件
                  </button>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-[86px_1fr] gap-2">
                    <select
                      value={draftOperator}
                      onChange={(event) => setDraftOperator(event.target.value as FilterOperator)}
                      className="rounded border border-zinc-200 bg-white px-1.5 py-1.5 text-[11px]"
                    >
                      {draftField.type === 'number' || draftField.type === 'percent' ? (
                        <>
                          <option value="gt">大于</option>
                          <option value="gte">大于等于</option>
                          <option value="lt">小于</option>
                          <option value="lte">小于等于</option>
                          <option value="equals">等于</option>
                          <option value="between">区间</option>
                        </>
                      ) : draftField.type === 'date' ? (
                        <>
                          <option value="after">不早于</option>
                          <option value="before">不晚于</option>
                          <option value="equals">等于</option>
                          <option value="between">区间</option>
                        </>
                      ) : (
                        <>
                          <option value="contains">包含</option>
                          <option value="equals">等于</option>
                        </>
                      )}
                    </select>
                    <input
                      type={
                        draftField.type === 'date'
                          ? 'date'
                          : draftField.type === 'number' || draftField.type === 'percent'
                            ? 'number'
                            : 'text'
                      }
                      value={draftValue}
                      onChange={(event) => setDraftValue(event.target.value)}
                      placeholder={draftField.type === 'text' ? '输入关键词' : '数值'}
                      className="min-w-0 rounded border border-zinc-200 px-2 py-1.5 text-[11px] outline-none focus:border-[#003e7e]"
                    />
                  </div>
                  {draftOperator === 'between' ? (
                    <input
                      type={draftField.type === 'date' ? 'date' : 'number'}
                      value={draftValueTo}
                      onChange={(event) => setDraftValueTo(event.target.value)}
                      placeholder="上限"
                      className="mt-2 w-full rounded border border-zinc-200 px-2 py-1.5 text-[11px] outline-none focus:border-[#003e7e]"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={addFilter}
                    disabled={!draftValue || (draftOperator === 'between' && !draftValueTo)}
                    className="mt-2 w-full rounded bg-[#003e7e] px-2 py-1.5 text-[11px] font-medium text-white hover:bg-[#002d5c] disabled:cursor-not-allowed disabled:bg-zinc-300"
                  >
                    添加条件
                  </button>
                </>
              )}

              {filters.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {filters.map((filter) => (
                    <span
                      key={filter.id}
                      className="inline-flex max-w-full items-center gap-1 rounded bg-blue-50 px-1.5 py-1 text-[10px] text-[#003e7e]"
                    >
                      <span className="truncate">{filterDescription(filter)}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setFilters((previous) => previous.filter((item) => item.id !== filter.id))
                        }
                        aria-label={`删除筛选条件 ${filterDescription(filter)}`}
                      >
                        <X size={11} />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex-1 overflow-auto p-2">
            {loadError ? (
              <div className="m-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {loadError}
              </div>
            ) : null}
            {candidates.map((row) => {
              const selected = selectedIds.has(row.id);
              const target = row.id === targetBuildingId;
              return (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => toggleProject(row.id)}
                  className={`mb-1 flex w-full items-start gap-2 rounded px-2.5 py-2 text-left transition ${
                    selected ? 'bg-blue-50' : 'hover:bg-zinc-50'
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                      selected ? 'border-[#003e7e] bg-[#003e7e] text-white' : 'border-zinc-300'
                    }`}
                  >
                    {selected ? <Check size={11} /> : null}
                  </span>
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-xs font-medium ${
                        target ? 'text-[#003e7e]' : 'text-zinc-700'
                      }`}
                    >
                      {row.name}{target ? <span className="ml-1 text-[10px]">当前</span> : null}
                    </span>
                    <span className="block truncate text-[10px] text-zinc-400">
                      {GRADE_LABEL[row.grade] || row.grade || '未分级'}
                      {row.submarket ? ` · ${row.submarket}` : ''}
                    </span>
                  </span>
                </button>
              );
            })}
            {!loading && candidates.length === 0 && !loadError ? (
              <p className="p-4 text-center text-xs text-zinc-400">没有匹配项目</p>
            ) : null}
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex shrink-0 items-center gap-4 border-b border-zinc-200 bg-white px-5 py-2.5 text-xs text-zinc-500">
            <span>最多选择 5 个竞品，可横向逐项比较。</span>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={onlyDifferences}
                onChange={(event) => setOnlyDifferences(event.target.checked)}
                className="accent-[#003e7e]"
              />
              仅看差异
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={onlyPopulated}
                onChange={(event) => setOnlyPopulated(event.target.checked)}
                className="accent-[#003e7e]"
              />
              隐藏空指标
            </label>
          </div>

          <div className="min-h-0 flex-1 overflow-auto">
            {loading ? (
              <div className="flex justify-center py-20">
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
              </div>
            ) : selectedRows.length === 0 ? (
              <div className="p-12 text-center text-sm text-zinc-400">请选择至少一个项目</div>
            ) : (
              <table className="min-w-full border-collapse text-xs">
                <thead className="sticky top-0 z-20 bg-zinc-50 shadow-sm">
                  <tr className="border-b-2 border-zinc-200">
                    <th className="sticky left-0 z-30 min-w-[180px] bg-zinc-50 px-4 py-3 text-left font-semibold text-zinc-500">
                      对比指标
                    </th>
                    {selectedRows.map((row) => (
                      <th
                        key={row.id}
                        className={`min-w-[180px] border-l border-zinc-100 px-4 py-2.5 text-left ${
                          row.id === targetBuildingId ? 'bg-blue-50' : 'bg-zinc-50'
                        }`}
                      >
                        <div
                          className={`font-semibold ${
                            row.id === targetBuildingId ? 'text-[#003e7e]' : 'text-zinc-700'
                          }`}
                        >
                          {row.name}
                        </div>
                        <div className="mt-1 font-normal text-[10px] text-zinc-400">
                          {GRADE_LABEL[row.grade] || row.grade || '未分级'}
                          {row.submarket ? ` · ${row.submarket}` : ''}
                          {row.metricPeriod ? ` · 经营数据 ${row.metricPeriod}` : ''}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {FIELD_GROUPS.map((group) => {
                    const visible = group.fields.filter(isVisible);
                    if (!visible.length) return null;
                    const collapsed = collapsedGroups.has(group.label);
                    return (
                      <React.Fragment key={group.label}>
                        <tr className="border-y border-zinc-200 bg-zinc-100">
                          <td
                            colSpan={selectedRows.length + 1}
                            className="sticky left-0 cursor-pointer px-3 py-2 font-semibold text-[#003e7e]"
                            onClick={() =>
                              setCollapsedGroups((previous) => {
                                const next = new Set(previous);
                                if (next.has(group.label)) next.delete(group.label);
                                else next.add(group.label);
                                return next;
                              })
                            }
                          >
                            {collapsed ? (
                              <ChevronRight size={14} className="mr-1 inline" />
                            ) : (
                              <ChevronDown size={14} className="mr-1 inline" />
                            )}
                            {group.label}
                            <span className="ml-2 text-[10px] font-normal text-zinc-400">
                              {visible.length} 项
                            </span>
                          </td>
                        </tr>
                        {!collapsed
                          ? visible.map((item) => (
                              <tr key={item.key} className="border-b border-zinc-100 hover:bg-zinc-50">
                                <td className="sticky left-0 z-10 bg-white px-4 py-2.5 font-medium text-zinc-600">
                                  <span>{item.label}</span>
                                  {item.unit ? (
                                    <span className="ml-1 text-[10px] font-normal text-zinc-400">
                                      ({item.unit})
                                    </span>
                                  ) : null}
                                </td>
                                {selectedRows.map((row) => {
                                  const value = valueFor(row, item);
                                  const missing = value === null || value === undefined || value === '';
                                  return (
                                    <td
                                      key={row.id}
                                      className={`border-l border-zinc-100 px-4 py-2.5 ${
                                        row.id === targetBuildingId
                                          ? 'bg-blue-50/30 font-medium text-[#003e7e]'
                                          : 'text-zinc-700'
                                      } ${missing ? 'text-zinc-300' : ''}`}
                                    >
                                      {formatValue(value, item)}
                                    </td>
                                  );
                                })}
                              </tr>
                            ))
                          : null}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function CompareClient() {
  return (
    <PageErrorBoundary pageName="楼宇对比">
      <CompareClientContent />
    </PageErrorBoundary>
  );
}
