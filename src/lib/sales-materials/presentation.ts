import type { SalesMaterial } from './model';

/** Display wording only; source evidence and stored extraction remain unchanged. */
export function materialBusinessCopy(text: string): string {
  const labels: Record<string,string> = {
    building_floors:'系统记录楼层',floors_above:'地上实际楼层',floors_below:'地下楼层',
    valid_until:'有效截止日期',valid_from:'有效起始日期',gfa_total:'总建筑面积',gfa_office:'办公建筑面积',
    gfa_retail:'商业建筑面积',leasable_area:'可租面积',floor_height:'层高',clear_height:'净高',
    standard_floor_area:'标准层面积',raised_floor_cm:'架空地板高度',elevator_passenger:'客梯数量',
    elevator_freight:'货梯数量',name_cn:'中文名称',tracking_scope:'跟踪范围',reference_only:'历史参考',
  };
  return text.replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/g,word=>labels[word] || word)
    .replace(/，保留候选系统关联，生产写入前(?:须)?复核/g,'')
    .replace(/；?佣金证据已另列于[^。]*\.json。?/g,'')
    .replace(/自动候选提到的/g,'所提及的')
    .replace(/原始OCR误读10\.6为19\.6、≤4000为小于1000，以原页为准/g,'原页正确数值为10.6米、≤4000㎡')
    .replace(/，此前OCR丢失等号/g,'')
    .replace(/现有快照|系统快照|此前快照|已有快照|快照/g,'已有记录')
    .replace(/，(?:原则上)?不(?:自动)?覆盖/g,'')
    .replace(/，不能覆盖/g,'')
    .replace(/有效截止日期留空/g,'有效截止日期未知')
    .replace(/。；/g,'。').trim();
}

/** A filename identifies the source version even when its business date is unknown. */
export function materialVersionLabel(record: SalesMaterial, records: SalesMaterial[]): string {
  const filename=record.original_name || record.title;
  const versions=records.filter(item=>(item.original_name || item.title)===filename);
  const suffix=versions.length>1 ? ` · 修订 ${versions.findIndex(item=>item.id===record.id)+1}` : '';
  const date=record.historical_context ? record.historical_context.period_label : record.data_date || record.document_date || '资料日期未知';
  return `${filename} · ${date}${suffix}`;
}
