'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/src/components/ui';
import { trustedQueryClient, queryScopeKey, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { cellText, units, resultScopeText, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { resultBuildingRows, type BuildingContext, type QueryBuildingRow } from '@/src/lib/intelligence/query/buildingCards';
import { queryMapHref } from '@/src/lib/intelligence/query/buildingNavigation';
import styles from './HomeQueryBuildings.module.css';

export function HomeQueryBuildings({ result, requestId, scope, onSource }: { result: QueryResultView; requestId: string; scope: QueryClientScope;
  onSource?: (ids: string[], label: string, trigger: HTMLButtonElement) => void }) {
  const buildings = useMemo(() => resultBuildingRows(result), [result]);
  if (!buildings.length) return null;
  return <BuildingResults key={`${queryScopeKey(scope)}:${requestId}:${result.resultId}`} result={result} requestId={requestId} scope={scope} buildings={buildings} onSource={onSource} />;
}
function BuildingResults({ result, requestId, scope, buildings, onSource }: { result: QueryResultView; requestId: string; scope: QueryClientScope; buildings: QueryBuildingRow[];
  onSource?: (ids: string[], label: string, trigger: HTMLButtonElement) => void }) {
  const [page, setPage] = useState(0), [context, setContext] = useState<BuildingContext | null>(null), [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const scopeKey = queryScopeKey(scope);
  useEffect(() => {
    const controller = new AbortController();
    setContext(null); setError(null);
    void trustedQueryClient.buildings(scope, { requestId, resultId: result.resultId, offset: page * 5, limit: 5 }, controller.signal)
      .then(value => { if (!controller.signal.aborted && value.resultId === result.resultId) setContext(value); })
      .catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : '楼宇信息暂时无法读取。'); });
    return () => controller.abort();
  // scope identity is serialized; refreshing React props must not reload the same page.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, requestId, result.resultId, page, revision]);
  return <section className={styles.section} aria-label="查询楼宇信息">
    <div className={styles.heading}><h3>{buildings.length === 1 ? '楼宇信息' : `本次结果 · ${buildings.length} 栋楼宇`}</h3>
      <Link className={styles.link} href={queryMapHref(requestId)} prefetch={false}>在地图中查看{buildings.length > 1 ? '全部项目' : ''}</Link></div>
    <p className={styles.note}>{resultScopeText(result)}。指标保留本次结果期间；子市场、等级和照片按当前目录读取。</p>
    {error ? <div role="alert"><p>{error}</p><Button variant="ghost" onClick={() => setRevision(value => value + 1)}>重试楼宇信息</Button></div>
      : !context ? <p role="status" className={styles.note}>正在核对楼宇访问权限与当前目录…</p>
      : <div className={styles.list}>{buildings.slice(page * 5, page * 5 + 5).map(building => {
        const metadata = context.buildings.find(item => item.id === building.id);
        return <BuildingCard key={building.id} building={building} metadata={metadata} result={result} requestId={requestId} scope={scope} single={buildings.length === 1} onSource={onSource} />;
      })}</div>}
    {buildings.length > 5 && <div className={styles.pagination}><span>第 {page * 5 + 1}–{Math.min(page * 5 + 5, buildings.length)} 栋，共 {buildings.length} 栋</span>
      <Button variant="ghost" disabled={page === 0} onClick={() => setPage(value => value - 1)}>上一组楼宇</Button>
      <Button variant="ghost" disabled={(page + 1) * 5 >= buildings.length} onClick={() => setPage(value => value + 1)}>下一组楼宇</Button></div>}
  </section>;
}
function BuildingCard({ building, metadata, result, requestId, scope, single, onSource }: { building: QueryBuildingRow; metadata?: BuildingContext['buildings'][number];
  result: QueryResultView; requestId: string; scope: QueryClientScope; single: boolean; onSource?: (ids: string[], label: string, trigger: HTMLButtonElement) => void }) {
  const [expanded, setExpanded] = useState(single), [photoRequested, setPhotoRequested] = useState(single);
  const [photo, setPhoto] = useState<BuildingContext['photoAccess']>(), [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const photoId = metadata?.photo?.id, scopeKey = queryScopeKey(scope);
  useEffect(() => {
    if (!photoRequested || !photoId) return;
    const controller = new AbortController();
    setPhoto(undefined); setError(null);
    void trustedQueryClient.buildings(scope, { requestId, resultId: result.resultId, buildingId: building.id, photoId, limit: 1 }, controller.signal)
      .then(value => { if (!controller.signal.aborted) { if (value.photoAccess) setPhoto(value.photoAccess); else setError('照片暂不可用。'); } })
      .catch(() => { if (!controller.signal.aborted) setError('照片暂时无法读取，请重试。'); });
    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, requestId, result.resultId, building.id, photoId, photoRequested, revision]);
  const columns = result.table.columns.filter(column => column.key !== 'name' && building.cells[column.key]);
  const visible = expanded ? columns : columns.slice(0, 2);
  return <article className={styles.card} aria-label={`${building.name}楼宇卡片`}>
    <div className={styles.cardHeading}><h4>{building.name}</h4><p>{metadata?.submarket ?? '子市场未知'} · {metadata?.grade ?? '等级未知'} <span>（当前目录）</span></p></div>
    {photoRequested && metadata?.photo && <figure className={styles.photo}>
      {photo ? <><img src={photo.url} alt={metadata.photo.caption} loading="lazy" onError={() => { setPhoto(undefined); setError('照片加载失败，请重试。'); }} />
        <figcaption>{metadata.photo.caption}{photo.license_url && <> · <a href={photo.source_url} target="_blank" rel="noopener noreferrer">{photo.source_name || '图片来源'}</a>{photo.attribution_text && ` · ${photo.attribution_text}`} · <a href={photo.license_url} target="_blank" rel="noopener noreferrer">许可说明</a></>}</figcaption></>
        : error ? <><p role="alert">{error}</p><Button variant="ghost" onClick={() => setRevision(value => value + 1)}>重试照片</Button></> : <p role="status">正在读取已存档照片…</p>}
    </figure>}
    {!metadata?.photo && single && <p className={styles.note}>暂无可访问的实景照片。</p>}
    <dl className={styles.fields}>{visible.map(column => {
      const cell = building.cells[column.key];
      const period = [...new Set(cell.sourceIds.flatMap(id => {
        const source = result.sources.find(item => item.id === id);
        return source?.period ? [`${source.period.year}Q${source.period.quarter}`] : [];
      }))].join('、');
      return <div key={column.key}><dt>{column.label}{period && <span> · {period}</span>}</dt><dd>{onSource ? <button type="button" onClick={event => onSource([...cell.sourceIds], `${building.name}：${column.label}`, event.currentTarget)}>{cellText(cell, column.unit)}</button> : cellText(cell, column.unit)}{cell.kind === 'number' && column.unit && <span> {units[column.unit] ?? column.unit}</span>}</dd></div>;
    })}</dl>
    {columns.length === 0 && <p className={styles.note}>本次结果未提供可单独展示的楼宇指标，期间和指标请见原分析结果。</p>}
    <div className={styles.actions}>
      {metadata?.located && <Link className={styles.link} href={queryMapHref(requestId, building.id, true)} prefetch={false}>查看楼宇详情</Link>}
      <Link className={styles.link} href={queryMapHref(requestId, building.id)} prefetch={false}>在地图中查看</Link>
      {columns.length > 2 && !single && <button type="button" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? '收起参数' : '展开全部参数'}</button>}
      {metadata?.photo && !single && <button type="button" aria-expanded={photoRequested} onClick={() => setPhotoRequested(value => !value)}>{photoRequested ? '收起照片' : '查看照片'}</button>}
    </div>
    {metadata?.unavailableReason && <p className={styles.note}>{metadata.unavailableReason === 'missing_coordinates' ? '缺少可靠坐标，地图无法定位；不会补造位置。现有楼宇详情依赖地图位置，已记录参数仍可在此卡片及来源中查看。' : '该项目当前不在地图目录，地图详情暂不可用；原查询快照仍保留。'}</p>}
  </article>;
}
