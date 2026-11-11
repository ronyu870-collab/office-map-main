'use client';

import * as React from 'react';
import Link from 'next/link';
import { useAppSession } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { WorkspaceShell } from '@/src/components/layout';
import { AppHeader, Button } from '@/src/components/ui';
import { reviewStatusLabels, type Candidate, type CandidatePage, type ReviewStatus, type SaveReview } from '@/src/lib/leaseExpiry/contracts';
import { LeaseReviewError, listLeaseReviews, saveLeaseReview } from '@/src/services/leaseExpiryApi';

const control = 'min-h-11 w-full rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border-strong)] bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[var(--cd-color-brand)]';
const blankDraft = { status: 'pending' as ReviewStatus, notes: '', evidence_reference: '' };
function draftOf(item: Candidate) {
  return item.review ? { status: item.review.status, notes: item.review.notes, evidence_reference: item.review.evidence_reference } : blankDraft;
}
const candidateKey = (item: Candidate) => `${item.source_kind}:${item.source.id}`;
const sourceLabel = (item: Candidate) => item.source_kind === 'live' ? '日常填报' : '历史导入';
const value = (text: unknown) => text === null || text === undefined || text === '' ? '—' : String(text);

export function LeaseExpiryWorkspace({ trialLabel }: { trialLabel?: string } = {}) {
  const { session, status } = useAppSession();
  const { isImpersonating } = useImpersonation();
  const permitted = status === 'authenticated' && session?.role === 'admin' && !isImpersonating;
  return <WorkspaceShell className="h-[100dvh]" header={<AppHeader title="预计到期线索" />}>
    <div className="h-full overflow-y-auto overscroll-contain">
    {trialLabel ? <p role="note" className="mx-auto max-w-5xl px-4 pt-4 text-sm text-[var(--cd-color-text-secondary)] sm:px-6">{trialLabel}</p> : null}
    {permitted && session ? <LeaseExpiryReviewPanel key={session.user.id} token={session.session.access_token} /> :
      <div className="mx-auto max-w-5xl p-4 text-sm"><p>{status === 'loading' ? '正在校验账号…' : '此清单仅供管理员试用，请登录管理员账号并退出用户模拟。'}</p><Link className="mt-4 inline-flex min-h-11 items-center underline" href="/intelligence">返回业务智能</Link></div>}
    </div>
  </WorkspaceShell>;
}

// Exported for isolated synthetic browser/component verification; never bypasses API authorization.
export function LeaseExpiryReviewPanel({ token }: { token: string }) {
  const [data, setData] = React.useState<CandidatePage | null>(null);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState({ query: '', scope: 'window', page: 1 });
  const [selected, setSelected] = React.useState<Candidate | null>(null);
  const [draft, setDraft] = React.useState(blankDraft);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState('');
  const [notice, setNotice] = React.useState('');
  const [blocked, setBlocked] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [reload, setReload] = React.useState(0);
  const attempt = React.useRef<{ body: string; input: SaveReview } | null>(null);
  const mounted = React.useRef(true);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const accessEpoch = React.useRef(0);
  const dirty = selected !== null && JSON.stringify(draft) !== JSON.stringify(draftOf(selected));
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const fail = React.useCallback((reason: unknown) => {
    if (!mounted.current) return;
    setError(reason instanceof Error ? reason.message : '请求未完成，请重试');
    if (reason instanceof LeaseReviewError && [401, 403, 503].includes(reason.status)) {
      // Authorization loss clears data and invalidates any older in-flight save.
      if (reason.status !== 503) { accessEpoch.current++; setData(null); setSelected(null); setDraft(blankDraft); setBlocked(true); }
    }
    if (reason instanceof LeaseReviewError && reason.status === 409) setConflict(true);
  }, []);
  React.useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true); setError('');
    void listLeaseReviews(token, filter.page, filter.query, filter.scope, controller.signal).then(result => {
      if (active) { setData(result); setBlocked(false); }
    }).catch(reason => { if (active) fail(reason); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [token, filter, reload, fail]);
  React.useEffect(() => {
    // Recheck on return to the tab and every minute; never replaces an open draft.
    const refresh = () => { if (document.visibilityState === 'visible') setReload(n => n + 1); };
    const timer = window.setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  React.useEffect(() => {
    if (!dirty && !saving) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    const navigate = (event: MouseEvent) => {
      if ((event.target as Element).closest('a[href]') && !window.confirm('补充记录尚未保存，确定离开吗？')) { event.preventDefault(); event.stopPropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', navigate, true); };
  }, [dirty, saving]);
  const canLeave = () => !saving && (!dirty || window.confirm('补充记录尚未保存，确定放弃当前输入吗？'));
  const choose = (item: Candidate) => {
    if (!canLeave()) return;
    panelRef.current?.parentElement?.scrollTo?.({ top: 0 });
    setSelected(item); setDraft(draftOf(item)); setConflict(false); setError(''); setNotice(''); attempt.current = null;
  };
  async function save() {
    if (!selected || !selected.source_available || saving || blocked || conflict) return;
    const body = { source_kind: selected.source_kind, source_id: selected.source.id, source_fingerprint: selected.source_fingerprint, expected_revision: selected.review?.revision ?? 0, ...draft };
    const signature = JSON.stringify(body);
    if (attempt.current?.body !== signature) attempt.current = { body: signature, input: { ...body, request_id: crypto.randomUUID() } };
    const epoch = accessEpoch.current;
    setSaving(true); setError(''); setNotice('');
    try {
      const review = await saveLeaseReview(token, attempt.current.input);
      if (!mounted.current || epoch !== accessEpoch.current) return;
      setSelected({ ...selected, review }); setDraft({ status: review.status, notes: review.notes, evidence_reference: review.evidence_reference });
      setData(previous => previous && { ...previous, items: previous.items.map(item => candidateKey(item) === candidateKey(selected) ? { ...item, review } : item) });
      setNotice('补充记录已保存，预计到期区间仍按成交数据计算。'); attempt.current = null;
    } catch (reason) { fail(reason); }
    finally { if (mounted.current) setSaving(false); }
  }
  return <div ref={panelRef} className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 text-sm leading-6 sm:px-6">
    <Link href="/intelligence" className="inline-flex min-h-11 items-center text-[var(--cd-color-brand)] underline">返回业务智能</Link>
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">未来 6 个月的预计到期线索</h2>
      <p>根据已有成交期间和租期自动估算，无需先补合同或逐条审核。结果用于发现跟进机会，不是已确认的合同到期日。</p>
      <p className="text-[var(--cd-color-text-secondary)]">管理员试点，暂不推送 Broker。日常填报与历史导入统一计算；仅纳入有日期或季度、租期为 1–120 个整数月的记录；未出现的记录不代表没有到期机会。</p>
    </section>
    {error && <div role="alert" className="rounded-md border border-[var(--cd-color-border)] bg-white p-3"><p>{error}</p>{!blocked && <Button className="mt-2 min-h-11" onClick={() => setReload(n => n + 1)}>重试读取清单</Button>}</div>}
    {notice && <p role="status">{notice}</p>}
    {!blocked && <>
      <form onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }} className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={event => {
        event.preventDefault(); if (!canLeave()) return; setSelected(null); setFilter({ ...filter, query: query.trim(), page: 1 });
      }}>
        <label className="min-w-0 flex-1">企业或楼宇<input className={control} value={query} maxLength={100} onChange={e => setQuery(e.target.value)} placeholder="输入名称筛选到期线索" /></label>
        <label className="sm:w-48">范围<select className={control} value={filter.scope} onChange={event => {
          if (!canLeave()) return; setSelected(null); setFilter({ query: query.trim(), page: 1, scope: event.target.value });
        }}><option value="window">未来 6 个月线索</option><option value="saved">全部已补充记录</option></select></label>
        <Button type="submit" className="min-h-11" disabled={saving}>筛选</Button>
      </form>
      <div aria-live="polite">{loading ? '正在读取…' : data ? `${data.total} 条 · 观察窗口 ${data.as_of} 至 ${data.window_end}（不含结束日）` : '尚未取得清单'}</div>
      {data && !selected && <section aria-label="预计到期候选" className="divide-y divide-[var(--cd-color-border)] rounded-md border border-[var(--cd-color-border)] bg-white">
        {data.items.length === 0 && <p className="p-4">当前范围没有匹配记录；这不代表没有真实到期租约。</p>}
        {data.items.map(item => <button key={candidateKey(item)} type="button" disabled={saving || loading} onClick={() => choose(item)}
          className="block w-full space-y-1 p-4 text-left hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)] disabled:opacity-60">
          <span className="block break-words font-medium">{value(item.source.company)} · {value(item.source.building)}</span>
          <span className="block">{sourceLabel(item)} · {item.source_available ? `预计到期 ${value(item.proxy_start)} — ${value(item.proxy_end)}` : '原成交已删除 · 只读历史记录'}</span>
          <span className="block text-[var(--cd-color-text-secondary)]">{item.review?.status === 'source_conflict' ? '来源有差异，按录入值估算' : item.review?.status === 'missing_info' ? '资料可后续补充' : '自动估算'}{item.has_later_name_match ? ' · 有较晚同名成交，可能涉及续租或迁移' : ''}{item.review && item.review.source_fingerprint !== item.source_fingerprint ? ' · 原始资料已变更' : ''}</span>
        </button>)}
      </section>}
      {data && !selected && <nav aria-label="候选分页" className="flex items-center justify-between gap-3"><Button variant="secondary" className="min-h-11" disabled={loading || saving || filter.page <= 1} onClick={() => { if (canLeave()) { setSelected(null); setFilter({ ...filter, page: filter.page - 1 }); } }}>上一页</Button><span>第 {data.page} 页</span><Button variant="secondary" className="min-h-11" disabled={loading || saving || filter.page * data.page_size >= data.total} onClick={() => { if (canLeave()) { setSelected(null); setFilter({ ...filter, page: filter.page + 1 }); } }}>下一页</Button></nav>}
      {selected && <section aria-label="线索详情" className="space-y-4 rounded-md border border-[var(--cd-color-border)] bg-white p-4 sm:p-5">
        <Button variant="secondary" className="min-h-11" disabled={saving} onClick={() => { if (canLeave()) setSelected(null); }}>返回清单</Button>
        <h2 className="break-words text-lg font-semibold">{value(selected.source.company)} · 预计到期</h2>
        <div className="space-y-2">
          {!selected.source_available ? <p>原成交已删除，以下为已存补充记录，不再参与预计到期计算。</p> : selected.proxy_start && selected.proxy_end ? <p>预计到期区间：{selected.proxy_start} — {selected.proxy_end}</p> : <p>当前成交期间或租期不满足估算条件，已存补充记录仍可查看。</p>}
          <p className="text-[var(--cd-color-text-secondary)]">按成交期间加录入租期自动估算，可直接作为跟进参考；实际起租、续租或搬迁可能使结果变化。</p>
          {selected.review?.status === 'source_conflict' && <p>存在来源差异，当前仍按系统录入值估算。</p>}
          {selected.review?.status === 'missing_info' && <p>已标记资料不足，可在跟进中补充，不影响显示预计到期线索。</p>}
          {selected.has_later_name_match && <p>同名企业与楼宇有较晚成交记录，可能涉及续租或迁移，不自动合并为同一合同。</p>}
          {selected.review && selected.review.source_fingerprint !== selected.source_fingerprint && <p>成交资料已有变化，预计区间按最新数据计算；此前补充记录需重新对照。</p>}
        </div>
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            ['数据来源', sourceLabel(selected)],
            ['成交期间', `${value(selected.source.period_start)} — ${value(selected.source.period_end)}`],
            ['录入租期', `${value(selected.source.lease_term_months)} 个月${selected.source_kind === 'history' ? `；原文：${value(selected.source.source_lease_term_raw)}` : ''}`],
            ['期间依据', selected.source.period_source?.includes('inferred') ? '由信息日期推定，非合同起租日' : '使用系统记录的成交期间，非合同起租日'],
            ['原资料信息日期', value(selected.source.source_info_date)],
            ['楼宇关联范围', ({ exact: '精确关联', project: '项目级关联，不能确定楼座', reference: '参考关联', unmapped: '尚未关联' } as Record<string, string>)[selected.source.building_match_scope] ?? selected.source.building_match_scope],
            ['来源定位', selected.source_kind === 'live' ? '系统内日常成交填报，按最新已保存数据计算' : `${value(selected.source.source_file)} / ${value(selected.source.source_sheet)} / 第 ${value(selected.source.source_row)} 行`],
          ].map(([label, text]) => <div key={label} className="min-w-0"><dt className="text-[var(--cd-color-text-secondary)]">{label}</dt><dd className="break-words">{text}</dd></div>)}
        </dl>
        <details key={candidateKey(selected)} className="border-t border-[var(--cd-color-border)] pt-2">
          <summary className="min-h-11 cursor-pointer py-2 focus-visible:outline-2 focus-visible:outline-[var(--cd-color-brand)]">补充资料或标记问题（可选）</summary>
          <div className="space-y-4 pt-2">
          <p>有新情况时再补充，不需要为查看线索填写。保存不会修改原始成交或确认合同到期日。</p>
        {selected.review && <p>已存补充记录版本 {selected.review.revision} · {new Date(selected.review.updated_at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}（北京时间）</p>}
        <fieldset disabled={saving || !selected.source_available} className="space-y-4">
          <label className="block">资料标记<select className={control} value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value as ReviewStatus })}>{Object.entries(reviewStatusLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="block">依据定位<input className={control} value={draft.evidence_reference} maxLength={1000} placeholder="选填：已有资料位置或沟通记录" onChange={e => setDraft({ ...draft, evidence_reference: e.target.value })} /></label>
          <label className="block">补充备注<textarea className={`${control} min-h-32 resize-y`} value={draft.notes} maxLength={4000} placeholder="选填：跟进中发现的新情况、资料缺口或来源差异" onChange={e => setDraft({ ...draft, notes: e.target.value })} /></label>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" className="min-h-11" disabled={!selected.source_available || saving || conflict || (draft.status !== 'pending' && !draft.notes.trim())} onClick={() => void save()}>{saving ? '正在保存…' : '保存补充记录'}</Button>
          <span>{dirty ? '有未保存的修改' : '补充信息不改变自动估算'}</span>
          {conflict && <Button variant="secondary" className="min-h-11" onClick={() => { if (canLeave()) { setSelected(null); setConflict(false); setReload(n => n + 1); } }}>放弃当前输入并重新载入</Button>}
        </div>
          </div>
        </details>
      </section>}
    </>}
  </div>;
}
