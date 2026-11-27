'use client';

import * as React from 'react';
import { fetchRepresentativeBrochures } from '@/src/services/map/marketAssetResearchClient';
import { MAX_COMPARE_SELECTION } from '@/src/lib/compareReadContract';
import { observeBusinessReading } from '@/src/utils/businessReadingAudit';
import { marketBrochureFields, projectBrochureParameters, type BrochureAsset } from '../model/marketBrochureComparison';
import { useMapObjectReadingState } from '../workspace/continuity';
import { researchNumber } from '../model/submarketResearch';
import styles from './MarketAssetAnalytics.module.css';

type Project = { id: string; name: string };
type Reading = { opened: boolean; selected: string[] | null };

export function RepresentativeBrochureMatrix({ projects, identity, active, onOpen }: {
  projects: readonly Project[]; identity: string; active: boolean; onOpen: (id: string) => void;
}) {
  const [reading, setReading] = useMapObjectReadingState<Reading>('marketBrochures', identity, { opened: false, selected: null });
  const [result, setResult] = React.useState<{ key: string; values: BrochureAsset[] | null; error: boolean } | null>(null);
  const [retry, setRetry] = React.useState(0);
  const available = new Set(projects.map(project => project.id));
  const ids = (reading.selected ?? projects.slice(0, 3).map(project => project.id))
    .filter(id => available.has(id)).slice(0, MAX_COMPARE_SELECTION);
  const key = JSON.stringify([ids, retry]);
  React.useEffect(() => {
    if (!active || !reading.opened) return;
    const [selected] = JSON.parse(key) as [string[], number];
    if (!selected.length) return;
    const controller = new AbortController();
    void fetchRepresentativeBrochures(selected, controller.signal).then(rows => {
      if (controller.signal.aborted) return;
      setResult({ key, values: projectBrochureParameters(rows, selected), error: false });
      observeBusinessReading('VIEW_BUILDING_COMPARISON', 'map', { target_table: 'buildings', target_id: selected[0], building_ids: selected, building_count: selected.length, observation: 'comparison_displayed' }, 'compare');
    }).catch(() => { if (!controller.signal.aborted) setResult({ key, values: null, error: true }); });
    return () => controller.abort();
  }, [active, reading.opened, key]);
  const values = active && result?.key === key ? result.values : null;
  const selected = ids.flatMap(id => projects.filter(project => project.id === id));
  const byId = new Map(values?.map(row => [row.buildingId, row]));
  const fields = marketBrochureFields.filter(field => values?.some(row => row.values[field.key] !== undefined));
  const hasCompletion = values?.some(row => row.completionDate !== null);
  const toggle = (id: string) => {
    setResult(null);
    setReading(previous => ({ ...previous, selected: ids.includes(id) ? ids.filter(value => value !== id) : [...ids, id].slice(0, MAX_COMPARE_SELECTION) }));
  };
  if (!projects.length) return null;
  return <section className={styles.analytics} aria-label="项目楼书参数">
    <button type="button" className={styles.action} aria-expanded={reading.opened} onClick={() => {
      setResult(null); setReading(previous => ({ ...previous, opened: !previous.opened }));
    }}>{reading.opened ? '收起楼书参数' : '比较代表项目楼书参数'}</button>
    {reading.opened && <>
      <div className={styles.projectChoices} role="group" aria-label="选择比较项目">{projects.map(project => <label key={project.id}>
        <input type="checkbox" checked={ids.includes(project.id)} disabled={!ids.includes(project.id) && ids.length >= MAX_COMPARE_SELECTION} onChange={() => toggle(project.id)} />{project.name}
      </label>)}</div>
      <p className={styles.subtle}>楼书记录 · 非季度行情</p>
      {!ids.length ? <p>请选择项目。</p> : !values ? result?.key === key && result.error
        ? <p role="status">楼书暂不可用。 <button className={styles.action} type="button" onClick={() => setRetry(value => value + 1)}>重试</button></p>
        : <p role="status">正在读取已选项目楼书…</p>
        : !fields.length && !hasCompletion ? <p className={styles.subtle}>所选项目暂无可比较楼书参数。</p>
          : <div className={styles.tableWrap}><table className={styles.matrix} aria-label="代表项目楼书参数比较"><thead><tr><th scope="col">参数</th>
            {selected.map(project => <th scope="col" key={project.id}><button type="button" className={styles.action} onClick={() => onOpen(project.id)}>{project.name}</button></th>)}</tr></thead>
            <tbody>{fields.map(field => <tr key={field.key}><th scope="row">{field.label} · {field.unit}</th>{selected.map(project => {
              const value = byId.get(project.id)?.values[field.key]; return <td key={project.id}>{value === undefined ? '—' : researchNumber(value, Number.isInteger(value) ? 0 : 2)}</td>;
            })}</tr>)}
            {hasCompletion && <tr><th scope="row">楼书竣工日期</th>{selected.map(project => <td key={project.id}>{byId.get(project.id)?.completionDate ?? '—'}</td>)}</tr>}
            <tr><th scope="row">资料入库日期</th>{selected.map(project => <td key={project.id}>{byId.get(project.id)?.recordedOn ?? '—'}</td>)}</tr>
            </tbody></table></div>}
    </>}
  </section>;
}
