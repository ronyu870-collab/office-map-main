'use client';

import * as React from 'react';
import { MaskedText } from '@/src/components/demo';
import { attachTitleTooltip } from '@/src/utils/titleTooltip';
import type { BuildingMetric } from '@/src/types';
import { isCommercialFutureSupply } from '../model/mapDomain';
import { getLatestMetric } from '@/src/utils/filterBuildings';

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
    type?: string | null;
  };
  displayOverrides?: Map<string, Map<string, DisplayOverride>>;
  onClick?: () => void;
}

function formatNumber(input: number): string {
  return !Number.isFinite(input) ? '-' : input.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

function formatVacancyRate(vacancyRate: number): string {
  return !Number.isFinite(vacancyRate) ? '-' : `${(vacancyRate <= 1 ? vacancyRate * 100 : vacancyRate).toFixed(1)}%`;
}

export const BuildingBasicCard = React.memo<BuildingBasicCardProps>(({ building, displayOverrides, onClick }) => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const latestMetric = getLatestMetric(building.metrics ?? []);
  const isFutureSupply = building._dataType === 'future';

  React.useEffect(() => {
    if (cardRef.current) attachTitleTooltip(cardRef.current);
  });

  const gradeOverride = displayOverrides?.get(building.id)?.get('grade');
  const submarketOverride = displayOverrides?.get(building.id)?.get('submarket');
  const name = building.name || '未命名项目';
  const gradeLabel = gradeOverride?.display_label ?? '楼宇等级';
  const gradeValue = (() => {
    if (gradeOverride?.display_value) return gradeOverride.display_value;
    const grade = (building.grade || '').trim().toUpperCase();
    if (!grade) return '—';
    if (grade === 'BP') return building.grade!;
    if (grade.includes('P')) return building.grade!.replace(/P/gi, 'A');
    return building.grade!;
  })();
  const completionYear = building.completion_year ? String(building.completion_year) : '—';
  const leed = building.leed_certification;
  const submarketLabel = submarketOverride?.display_label ?? '子市场';
  const submarketValue = submarketOverride?.display_value ?? building.submarket ?? '—';
  const owner = building.owner || '暂无';
  const propertyMgmt = building.property_management || '暂无';

  const currentRent = latestMetric ? Number(latestMetric.net_effective_rent) : 0;
  const rentText = latestMetric ? formatNumber(currentRent) : '-';
  const faceRentText = latestMetric && latestMetric.face_rent ? formatNumber(Number(latestMetric.face_rent)) : '-';
  const vacText = latestMetric ? formatVacancyRate(latestMetric.vacancy_rate) : '-';
  const mgtFeeText = latestMetric && latestMetric.management_fee ? formatNumber(latestMetric.management_fee) : '-';
  const latestQuarter = latestMetric ? `${latestMetric.record_year}Q${latestMetric.record_quarter}` : '无数据';
  const hasLeed = leed && leed !== 'NULL' && leed !== '';

  const row = (label: string, value: string, emphasized = false, masked = false, titleText?: string) => (
    <div className="grid grid-cols-[74px_minmax(0,1fr)] items-baseline gap-2 border-b border-[#edf0f4] py-1.5 last:border-b-0">
      <span className="text-[10px] text-[#8a94a6]">{label}</span>
      <span title={titleText || value} className={`truncate text-right text-[10px] font-medium tabular-nums ${emphasized ? 'font-semibold text-[#003e7e]' : 'text-[#172033]'}`}>
        {masked ? <MaskedText>{value}</MaskedText> : value}
      </span>
    </div>
  );

  return (
    <div
      ref={cardRef}
      onClick={onClick}
      className="group cursor-pointer overflow-hidden rounded-[6px] border border-[#d9e0e8] bg-white transition-colors hover:border-[#aeb9c7] hover:bg-[#fbfcfd] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#003e7e]/20"
      role="button"
      tabIndex={0}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClick?.();
        }
      }}
    >
      <div className="border-b border-[#d9e0e8] bg-[#f8fafc] px-3 py-2.5">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 title={name} className="truncate text-[12px] font-semibold leading-5 text-[#172033] transition-colors group-hover:text-[#003e7e]">
              <MaskedText>{name}</MaskedText>
            </h3>
            <div className="mt-0.5 truncate text-[10px] text-[#8a94a6]">{[building.district, submarketValue, gradeValue].filter(value => value && value !== '—').join(' · ') || '项目信息待完善'}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {hasLeed ? <span className="rounded-[3px] border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700">LEED {leed}</span> : null}
            {isFutureSupply ? <span className="rounded-[3px] border border-[#b7cadf] bg-[#edf4fb] px-1.5 py-0.5 text-[10px] font-medium text-[#003e7e]">{isCommercialFutureSupply(building) ? '商业未来供应' : '未来供应'}</span> : null}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 border-b border-[#d9e0e8] bg-white">
        <div className="border-r border-[#edf0f4] px-3 py-2">
          <div className="text-[10px] text-[#8a94a6]">净有效租金</div>
          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#003e7e]">{rentText}<span className="ml-0.5 text-[10px] font-normal text-[#8a94a6]">元/㎡/月</span></div>
        </div>
        <div className="border-r border-[#edf0f4] px-3 py-2">
          <div className="text-[10px] text-[#8a94a6]">空置率</div>
          <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-[#172033]">{vacText}</div>
        </div>
        <div className="px-3 py-2">
          <div className="text-[10px] text-[#8a94a6]">数据期</div>
          <div className="mt-0.5 text-[11px] font-semibold tabular-nums text-[#172033]">{latestQuarter}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-x-4 px-3 py-1.5">
        <div>
          {row(gradeLabel, gradeValue)}
          {row(submarketLabel, submarketValue, false, false, submarketOverride ? submarketValue : building.submarket)}
          {row('入市时间', completionYear)}
          {row('项目业主', owner, false, true, building.owner)}
        </div>
        <div>
          {row('表面租金', faceRentText)}
          {row('物业费', mgtFeeText)}
          {row('物业公司', propertyMgmt, false, true, building.property_management)}
          {row('更新时间', latestQuarter, true)}
        </div>
      </div>
    </div>
  );
});

BuildingBasicCard.displayName = 'BuildingBasicCard';
