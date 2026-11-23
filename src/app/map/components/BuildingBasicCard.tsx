'use client';

import * as React from 'react';
import { MaskedText } from '@/src/components/demo';
import { attachTitleTooltip } from '@/src/utils/titleTooltip';
import type { BuildingMetric } from '@/src/types';
import { leedDisplayValue } from '@/src/lib/leed-display';
import { futureSupplyDate } from '@/src/lib/future-supply-status';
import { futureSupplyDisplayLabel } from '../model/mapDomain';
import { displayListGrade, finiteMetric, listBuildingValues, listVacancyPercent } from '../model/fullBuildingList';

interface DisplayOverride { display_label: string; display_value: string }
interface BuildingBasicCardProps {
  building: {
    id: string; name: string; grade?: string; completion_year?: number | string;
    leed_certification?: string; district?: string; submarket?: string; owner?: string;
    property_management?: string; metrics?: BuildingMetric[]; _dataType?: 'existing' | 'future';
    type?: string | null; status?: string | null; total_area?: number | null;
    launch_year?: number | null; launch_quarter?: string | null;
  };
  displayOverrides?: Map<string, Map<string, DisplayOverride>>;
  current?: boolean;
  onClick?: () => void;
}
const format = (value: unknown, digits=1) => {
  const number=finiteMetric(value);
  return number===null ? '—' : number.toLocaleString('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits});
};

export const BuildingBasicCard = React.memo<BuildingBasicCardProps>(({ building, displayOverrides, current, onClick }) => {
  const cardRef=React.useRef<HTMLDivElement>(null);
  const values=listBuildingValues(building), future=building._dataType==='future';
  const grade=displayOverrides?.get(building.id)?.get('grade');
  const submarket=displayOverrides?.get(building.id)?.get('submarket');
  const metadata=[building.district,submarket ? `${submarket.display_label}：${submarket.display_value}` : building.submarket,
    grade ? `${grade.display_label}：${grade.display_value}` : displayListGrade(building.grade)].filter(value=>value && value!=='—').join(' · ');
  const vacancy=listVacancyPercent(values.vacancy);
  React.useEffect(()=>{if(cardRef.current)attachTitleTooltip(cardRef.current);});
  const field=(label:string,value:string,masked=false,unit?:string)=><div><dt>{label}</dt><dd>{masked ? <MaskedText>{value}</MaskedText> : value}{unit ? <span> {unit}</span> : null}</dd></div>;
  return <div ref={cardRef} onClick={onClick} className="workspace-basic-card" role="button" aria-current={current || undefined} tabIndex={0}
    onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onClick?.();}}}>
    <header className="workspace-card-identity">
      <h3><MaskedText>{building.name || '未命名项目'}</MaskedText></h3>
      <p>{metadata || '项目信息待完善'}</p>
      {future ? <p className="workspace-card-status">{futureSupplyDisplayLabel(building)}</p> : null}
    </header>
    <section className="workspace-card-metrics" aria-label={future ? '规划指标' : '经营指标'}>
      {!future ? <p className="workspace-period">{values.period ? `${values.period} 指标` : '暂无季度指标'}</p> : null}
      <dl className="workspace-building-metrics">
        {future ? <div className="workspace-rent-metric"><dt>规划总体量</dt><dd>{format(values.area,0)}<span>㎡</span></dd></div> : <>
          <div className="workspace-rent-metric"><dt>净有效租金</dt><dd>{format(values.rent)}<span>元/㎡/月</span></dd></div>
          <div><dt>空置率</dt><dd>{vacancy===null ? '—' : vacancy.toFixed(1)+'%'}</dd></div>
          <div><dt>统计面积</dt><dd>{format(values.area,0)}<span>㎡</span></dd></div>
        </>}
      </dl>
    </section>
    <div className="workspace-card-details">
      <dl className="workspace-building-facts">
        {future ? field('预计时间',futureSupplyDate(building)) : field('入市年份',building.completion_year ? String(building.completion_year) : '未提供')}
        {field('LEED',leedDisplayValue(building.leed_certification))}
      </dl>
      <dl className="workspace-building-facts workspace-card-ownership">
        {field('项目业主',building.owner || '未提供',true)}
        {field('物业公司',building.property_management || '未提供',true)}
      </dl>
      {!future ? <dl className="workspace-building-facts workspace-card-costs">
        {field('表面租金',format(values.metric?.face_rent),false,'元/㎡/月')}
        {field('物业费',format(values.metric?.management_fee),false,'元/㎡/月')}
      </dl> : null}
    </div>
  </div>;
});
BuildingBasicCard.displayName='BuildingBasicCard';
