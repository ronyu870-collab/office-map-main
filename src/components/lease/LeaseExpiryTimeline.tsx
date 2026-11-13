'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLeaseExpiryAccess } from './useLeaseExpiryAccess';
import { AppHeader, Button, LoadingState } from '@/src/components/ui';
import type { ExpiryPage, ExpiryCandidate } from '@/src/lib/leaseExpiry/contracts';
import { expiryBar, expiryLabel, expiryAxisMonths, expiryNeedsReview } from '@/src/lib/leaseExpiry/timeline';
import { LeaseReviewError } from '@/src/services/leaseExpiryApi';
import { listLeaseExpiries } from '@/src/services/leaseExpiryTimelineApi';
import styles from './LeaseExpiryTimeline.module.css';

export function LeaseExpiryTimeline() {
  const router = useRouter();
  const { permitted, session, status } = useLeaseExpiryAccess();
  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
    if (status === 'authenticated' && !permitted) router.replace('/lease-submission');
  }, [router, status, permitted]);

  if (status === 'loading') return <LoadingState label="正在校验账号" rows={0} />;
  if (!permitted || !session) return null;
  return <div className={styles.workspace}>
    <header className={styles.header}><AppHeader title="租约到期" actions={<Link href="/lease-submission" aria-label="返回租赁成交" className={styles.back}><ChevronLeft size={16} aria-hidden="true" />租赁成交</Link>} /></header>
    <main className={styles.main}>
      <LeaseExpiryTimelinePanel key={`${session.user.id}:${session.session.access_token}`} token={session.session.access_token} />
    </main>
  </div>;
}

export function LeaseExpiryTimelinePanel({ token }: { token: string }) {
  const [page, setPage] = React.useState(1);
  const [data, setData] = React.useState<ExpiryPage | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');
  const [reload, setReload] = React.useState(0);
  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError(''); setData(null);
    void listLeaseExpiries(token, page, controller.signal).then(result => {
      if (!active) return;
      const last = Math.max(1, Math.ceil(result.total / result.page_size));
      if (page > last) { setPage(last); return; }
      setData(result);
    }).catch(reason => { if (active) { setData(null); setError(reason instanceof LeaseReviewError ? reason.message : '到期记录读取失败，请检查网络后重试'); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, page, reload]);
  React.useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setReload(value => value + 1); };
    const timer = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const visible = data?.page === page ? data : null;
  return <>
    <div className={styles.heading}><h2>未来六个月的预计到期企业</h2>{visible && <span>{visible.as_of} — {visible.window_end}（不含结束日）</span>}</div>
    {loading && <LoadingState label="正在读取到期记录" rows={4} />}
    {error && <div role="alert" className={styles.error}><p>{error}</p><Button variant="secondary" onClick={() => setReload(value => value + 1)}>重新读取</Button></div>}
    {!loading && visible && <>
      {visible.items.length === 0 ? <p className={styles.empty}>未来六个月暂无可估算的到期记录。</p> :
        <div className={styles.timeline} role="table" aria-label="企业预计到期时间图">
          <div className={styles.tableHead} role="row"><span role="columnheader">企业与原成交信息</span><div className={styles.months} role="columnheader" aria-label="预计到期时间">{expiryAxisMonths(visible.as_of, visible.window_end).map(month => <span key={month.key} style={{ left: `${month.left}%` }}>{month.label}</span>)}</div></div>
          {visible.items.map(item => {
            const bar = item.source_available ? expiryBar(item.proxy_start, item.proxy_end, visible.as_of, visible.window_end) : null;
            return <div className={styles.row} role="row" key={`${item.source_kind}:${item.source.id}`}>
              <LeaseDetails item={item} />
              <div className={styles.plot} role="cell">
                {bar && <span aria-hidden="true" className={`${styles.bar} ${bar.point ? styles.point : ''} ${bar.after ? styles.continued : ''}`} style={{ left: `${bar.left}%`, width: bar.point ? '7px' : `${bar.width}%` }} />}
                <span className={styles.date}><span className={styles.mobileDateLabel}>预计到期 </span>{item.source_available ? expiryLabel(item.proxy_start, item.proxy_end) : '原成交已不可用'}{expiryNeedsReview(item) ? ' · 待核对' : ''}</span>
              </div>
            </div>;
          })}
        </div>}
      <div className={styles.footer}><p>共 {visible.total} 条成交记录 · 日期为估算</p>{visible.total > visible.page_size && <nav aria-label="到期记录分页"><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>上一页</Button><span>{page} / {Math.ceil(visible.total / visible.page_size)}</span><Button variant="secondary" disabled={page * visible.page_size >= visible.total} onClick={() => setPage(value => value + 1)}>下一页</Button></nav>}</div>
    </>}
    <p className={styles.note}>按原成交时间和租期估算，不代表已确认的合同到期日。待核对表示有后续成交或来源变化；缺少日期或租期的记录不在图中。</p>
  </>;
}

function LeaseDetails({ item }: { item: ExpiryCandidate }) {
  const details = item.details;
  const recorded = details?.industry?.trim();
  const period = item.source.period_start && item.source.period_end ? expiryLabel(item.source.period_start, item.source.period_end) : '未记录';
  const area = details?.area_sqm;
  return <div className={styles.identity} role="cell">
    <div className={styles.company}><strong>{item.source.company || '企业名称未记录'}</strong><span>{item.source.building || '楼宇未记录'}</span></div>
    <dl className={styles.facts}>
      <div><dt>{item.source.period_source?.includes('inferred') ? '成交期间（推定）' : '成交时间'}</dt><dd>{period}</dd></div>
      <div><dt>租期</dt><dd>{item.source.lease_term_months ? `${item.source.lease_term_months} 个月` : '未记录'}</dd></div>
      <div><dt>面积</dt><dd>{typeof area === 'number' && Number.isFinite(area) && area > 0 ? `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(area)} ㎡` : '未记录'}</dd></div>
    </dl>
    <div className={styles.context}>
      <div><span className={styles.label}>行业</span><span>{recorded ? `${recorded}${details?.sub_industry?.trim() && details.sub_industry.trim() !== recorded ? ` / ${details.sub_industry.trim()}` : ''}` : '未记录'}</span></div>
      <div><span className={styles.label}>子市场</span><span>{details?.sub_market?.trim() || '未记录'}</span></div>
    </div>
  </div>;
}
