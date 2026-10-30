'use client';

import { FileImage } from 'lucide-react';
import type { AvailabilityRow, MaterialProvenance, SalesMaterial, TimeEvidence } from '@/src/lib/sales-materials/model';
import { formatSourceTime, rowAsOf } from '@/src/lib/sales-materials/timing';
import styles from './SalesMaterials.module.css';

function Event({ label, event, unknown }: { label: string; event: TimeEvidence | null | undefined; unknown: string }) {
  return <div className={styles.event}>
    <dt>{label}</dt>
    <dd>{event ? <><time dateTime={event.value}>{formatSourceTime(event.value)}</time><p className={styles.evidence}>依据：{event.evidence}</p></> : unknown}</dd>
  </div>;
}

export default function SalesMaterialTiming({ row, material, provenance, onViewOriginal, sourceRef }: {
  row?: AvailabilityRow; material: SalesMaterial; provenance: MaterialProvenance; onViewOriginal?: () => void; sourceRef?: string;
}) {
  const asOf = row ? rowAsOf(row, material, provenance) : provenance.as_of;
  return <section aria-label={`${row?.floor_unit || material.scope_label || material.title}的时间来源`} className={styles.timing}>
    <dl className={styles.timeline}>
      <Event label="数据截至" event={asOf} unknown={material.document_date ? '资料日期缺少依据' : '业主日期未注明'} />
      {material.document_date && provenance.document_date_evidence ? <Event label="原件日期" event={{value:material.document_date,evidence:provenance.document_date_evidence}} unknown="" /> : null}
      <Event label="业主确认" event={row?.timing?.confirmed} unknown="未记录业主确认" />
      <Event label="资料接收" event={provenance.received} unknown="接收时间未记录" />
      <div className={styles.event}><dt>解析入库</dt><dd><time dateTime={provenance.version_recorded_at}>{formatSourceTime(provenance.version_recorded_at)}</time><p className={styles.evidence}>依据：本版本入库的系统记录。此时间不代表业主更新或确认。</p></dd></div>
    </dl>
    <div className={styles.sourceFooter}>
      <p className={styles.sourceReference}>{material.source} · {material.title}<span>{sourceRef || row?.source_row_ref || (row ? `对应房源：${row.floor_unit}` : '')}</span></p>
      {onViewOriginal ? <button type="button" onClick={onViewOriginal} className={styles.sourceLink}><FileImage size={14} aria-hidden />查看对应原件</button> : <span>原件已本地归档</span>}
    </div>
  </section>;
}
