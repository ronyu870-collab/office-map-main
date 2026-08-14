'use client';

import * as React from 'react';
import { MaskedText } from '@/src/components/demo';
import { attachTitleTooltip } from '@/src/utils/titleTooltip';
import type { BuildingMetric } from '@/src/types';
import { getLatestMetric } from '@/src/utils/filterBuildings';

// 🌟 Phase 3: 楼宇基础信息卡片组件
// 精准复刻 MapController.buildInfoWindowContent() 上半部分的数据结构
// 使用 Tailwind CSS 替代内联样式，保持系统设计规范

interface DisplayOverride {
  display_label: string;
  display_value: string;
}

interface BuildingBasicCardProps {
  building: {
    id: string;
    name: string;
    grade?: string;
    completion_year?: number | string;
    leed_certification?: string;
    district?: string;
    submarket?: string;
    owner?: string;
    property_management?: string;
    metrics?: BuildingMetric[];
    _dataType?: 'existing' | 'future';
  };
  displayOverrides?: Map<string, Map<string, DisplayOverride>>;
  onClick?: () => void;
}

// 辅助函数：格式化数字
function formatNumber(input: number): string {
  return !Number.isFinite(input) ? '-' : input.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

// 辅助函数：格式化空置率
function formatVacancyRate(vacancyRate: number): string {
  return !Number.isFinite(vacancyRate) 
    ? '-' 
    : `${(vacancyRate <= 1 ? vacancyRate * 100 : vacancyRate).toFixed(1)}%`;
}

export const BuildingBasicCard = React.memo<BuildingBasicCardProps>(({ building, displayOverrides, onClick }) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const latestMetric = getLatestMetric(building.metrics ?? []);
  const isFutureSupply = building._dataType === 'future';

  // CL-033: 替换原生 title 为即时 tooltip
  React.useEffect(() => {
    if (cardRef.current) attachTitleTooltip(cardRef.current);
  });

  // 检查显示覆盖规则
  const gradeOverride = displayOverrides?.get(building.id)?.get('grade');
  const submarketOverride = displayOverrides?.get(building.id)?.get('submarket');

  const name = building.name || '未命名项目';
  const gradeLabel = gradeOverride?.display_label ?? '楼宇等级';
  const gradeValue = (() => {
    if (gradeOverride?.display_value) return gradeOverride.display_value;
    const g = (building.grade || '').trim().toUpperCase();
    if (!g) return '—';
    if (g === 'BP') return building.grade!;
    if (g.includes('P')) return building.grade!.replace(/P/gi, 'A');
    return building.grade!;
  })();
  const completionYear = building.completion_year ? String(building.completion_year) : '—';
  const leed = building.leed_certification;
  const submarketLabel = submarketOverride?.display_label ?? '子市场';
  const submarketValue = submarketOverride?.display_value ?? building.submarket ?? '—';
  const owner = building.owner || '暂无';
  const propertyMgmt = building.property_management || '暂无';

  const currentRent = latestMetric ? Number(latestMetric.net_effective_rent) : 0;
  const rentText = latestMetric ? `¥${formatNumber(currentRent)}` : '-';
  const faceRentText = latestMetric && latestMetric.face_rent ? `¥${formatNumber(Number(latestMetric.face_rent))}` : '-';
  const vacText = latestMetric ? formatVacancyRate(latestMetric.vacancy_rate) : '-';
  const mgtFeeText = latestMetric && latestMetric.management_fee ? `¥${formatNumber(latestMetric.management_fee)}` : '-';
  const latestQuarter = latestMetric ? `${latestMetric.record_year}Q${latestMetric.record_quarter}` : '无数据';

  const hasLeed = leed && leed !== 'NULL' && leed !== '';

  const ROW = (label: string, value: string, valueColor = 'text-zinc-800', masked = false, titleText?: string) => (
    <div className="flex items-center justify-between py-1 border-b border-zinc-50 last:border-0">
      <span className="text-[11px] text-zinc-500 whitespace-nowrap">{label}</span>
      <span title={titleText || value} className={`text-[11px] font-semibold ${valueColor} text-right truncate ml-2`}>
        {masked ? <MaskedText>{value}</MaskedText> : value}
      </span>
    </div>
  );

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      className="group relative cursor-pointer rounded-xl border border-transparent bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] transition-all duration-150 hover:border-zinc-200 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] hover:-translate-y-0.5 active:scale-[0.99]"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="mb-2 flex items-center gap-2">
        <h3 title={name} className="flex-1 text-base font-bold leading-tight text-zinc-900 group-hover:text-[#003e7e] transition-colors truncate whitespace-nowrap overflow-hidden text-ellipsis">
          <MaskedText>{name}</MaskedText>
        </h3>
        {isFutureSupply && (
          <span className="shrink-0 inline-block rounded-md bg-emerald-500 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-sm">
            未来供应
          </span>
        )}
      </div>

      {hasLeed && (
        <div className="mb-2">
          <span className="inline-block rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            LEED {leed}
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4">
        <div>
          {ROW(gradeLabel, gradeValue)}
          {ROW(submarketLabel, submarketValue, 'text-zinc-800', false, submarketOverride ? submarketValue : building.submarket)}
          {ROW('入市时间', completionYear)}
          {ROW('项目业主', owner, 'text-zinc-800', true, building.owner)}
          {ROW('物业公司', propertyMgmt, 'text-zinc-800', true, building.property_management)}
        </div>
        <div>
          {ROW('空置率', vacText)}
          {ROW('表面租金', faceRentText)}
          {ROW('净有效租金', rentText, 'text-[#003e7e]')}
          {ROW('物业费', mgtFeeText)}
          {ROW('更新时间', latestQuarter, 'text-[#003e7e]')}
        </div>
      </div>
    </div>
  );
});

BuildingBasicCard.displayName = 'BuildingBasicCard';
