'use client';

import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { AvailabilityRow, MaterialProvenance, SalesMaterial } from '@/src/lib/sales-materials/model';
import { rowTimeLabel } from '@/src/lib/sales-materials/timing';
import SalesMaterialTiming from './SalesMaterialTiming';
import styles from './SalesMaterials.module.css';

const number = (value: number | null) => value == null ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const rentUnit = (row: AvailabilityRow) => row.rent_basis === 'unspecified' || row.rent_unit === 'unspecified' ? '原文报价' : `元/${row.rent_unit === 'workstation' ? '工位' : '㎡'}/${row.rent_basis === 'month' ? '月' : '日'}`;

export default function SalesMaterialDetails({ rows, material, provenance, onViewOriginal }: {
  rows: AvailabilityRow[]; material: SalesMaterial; provenance: MaterialProvenance; onViewOriginal: () => void;
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  const prefix = useId();
  const commonNote = rows[0]?.price_note && rows.every(row => row.price_note === rows[0].price_note) ? rows[0].price_note : '';
  const timeLabels = rows.map(row => rowTimeLabel(row, material, provenance));
  const differentTimes = timeLabels.some(label => label !== timeLabels[0]);

  if (!rows.length) return <p className="py-12 text-center text-sm text-slate-400">暂无可租房源</p>;
  return <section aria-label="可租房源">
    <div className={styles.cards}>{rows.map((row, index) => {
      const [date] = timeLabels[index].split(' · ');
      const open = expanded === index;
      const note = [!commonNote && row.price_note, row.notes].filter(Boolean).join('；');
      return <article key={index} className={styles.card} aria-labelledby={`${prefix}-title-${index}`}>
        <div className={styles.cardHeading}>
          <h3 id={`${prefix}-title-${index}`} className={styles.cardFloor}>{row.floor_unit}</h3>{row.availability_status ? <span className={styles.inventoryStatus}>{row.availability_status}</span> : null}
          <dl className={styles.cardSummary}>
            <div><dt className="sr-only">面积</dt><dd>{row.area_text || number(row.area_sqm)}<small>{row.area_basis || '㎡'}</small></dd></div>
            <div><dt className="sr-only">租金</dt><dd>{row.quote_text || (row.asking_rent == null ? <small>未提供报价</small> : number(row.asking_rent))}{row.quote_text || row.asking_rent != null ? <small>{rentUnit(row)}</small> : null}</dd></div>
          </dl>
        </div>
        <dl className={styles.cardFacts}>
          {row.orientation ? <div><dt>朝向</dt><dd>{row.orientation}</dd></div> : null}
          {row.delivery_condition || row.delivery_time ? <div><dt>交付</dt><dd>{[row.delivery_condition, row.delivery_time].filter(Boolean).join(' · ')}</dd></div> : null}
          {row.management_fee != null ? <div><dt>物业费</dt><dd>{number(row.management_fee)} 元/㎡/月</dd></div> : null}
        </dl>
        {note ? <details className={styles.cardDisclosure}><summary>房源详情<ChevronDown size={13} aria-hidden /></summary><p>{note}</p></details> : null}
        {differentTimes ? <div className={styles.cardTimeBar}>
          <button type="button" className={styles.cardTimeButton} data-unknown={date === '时效未核实'}
            aria-label={`${row.floor_unit} · 时间来源`} aria-expanded={open}
            aria-controls={open ? `${prefix}-timing-${index}` : undefined}
            onClick={() => setExpanded(previous => previous === index ? null : index)}>
            <span className={styles.cardTimeDate}>{date}</span>
            <ChevronDown size={13} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined }} />
          </button>
        </div> : null}
        {open ? <div className={styles.cardDetail} id={`${prefix}-timing-${index}`}>
          <SalesMaterialTiming row={row} material={material} provenance={provenance} onViewOriginal={onViewOriginal} />
        </div> : null}
      </article>;
    })}</div>
    {commonNote ? <p className={styles.commonNote}>{commonNote}</p> : null}
  </section>;
}
