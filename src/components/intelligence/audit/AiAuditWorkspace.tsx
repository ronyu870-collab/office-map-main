'use client';

import * as React from 'react';
import Link from 'next/link';
import { useAppSession } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { isIntelligencePreviewEnabled } from '@/src/config/intelligencePreview';
import { HomeQueryResult } from '@/src/components/home/HomeQueryResult';
import { resultViewSchema } from '@/src/lib/intelligence/query/presentation';
import { auditEntries, auditStates, auditEntryLabels, auditStateLabels, auditFilterSchema, auditSubmittedText,
  type AuditFilter, type AuditItem, type AuditList, type AuditIntake, type AuditStream } from '@/src/lib/intelligence/query/auditConsoleView';
import { aiAuditClient, AuditReadError, type AuditScope } from '@/src/services/aiAuditClient';
import type { AuditExportTarget } from '@/src/lib/intelligence/query/auditExportView';
import styles from './AiAuditWorkspace.module.css';

const localTime = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
const dateTimeInput = (time: number) => new Date(time + 8 * 3600000).toISOString().slice(0, 19);
const inputTimestamp = (value: string) => `${value.length === 16 ? value + ':00' : value}+08:00`;
type Draft = { from: string; to: string; keyword: string; actorId: string; actorSearch: string; state: string; entry: string };
const initialDraft = (): Draft => ({ from: dateTimeInput(Date.now() - 7 * 86400000), to: dateTimeInput(Date.now()), keyword: '', actorId: '', actorSearch: '', state: '', entry: '' });
const validRange = (filter: AuditFilter) => Date.parse(filter.to) > Date.parse(filter.from)
  && Date.parse(filter.to) - Date.parse(filter.from) <= 31 * 86400000 && Date.parse(filter.to) <= Date.now();
type Selected = { item: AuditItem; intake?: AuditIntake; stream?: AuditStream };
const eventNames: Record<string, string> = { received: '接收问题', admitted: '权限准入', running: '开始执行',
  response_generated: '生成回答快照', response_prepared: '准备返回响应', succeeded: '执行完成', failed: '执行失败', denied: '拒绝请求',
  cancelled: '取消', tool_started: '开始读取', tool_completed: '读取完成', client_received: '客户端报告收到',
  client_rendered: '客户端报告渲染', download_dispatch: '客户端发起下载' };

function DocumentDetails({ value, label = '查看留存字段' }: { value: unknown; label?: string }) {
  return <details className={styles.document}><summary>{label}</summary><pre>{JSON.stringify(value, null, 2) ?? '未留存'}</pre></details>;
}

function RecordDetails({ selected, loadStream, busy, directoryAsOf, exportRecord }: { selected: Selected; loadStream: () => void; busy: boolean; directoryAsOf: string; exportRecord: () => void }) {
  const { item, intake, stream } = selected;
  const original = intake?.record?.document ?? stream?.record?.events.find(event => event.kind === 'received')?.document;
  const question = auditSubmittedText(original);
  const parsed = React.useMemo(() => resultViewSchema.safeParse(stream?.record?.generatedArchive), [stream]);
  return <section className={styles.detail} aria-label="记录详情">
    <h2>完整提交记录</h2>
    <p className={styles.muted}>{localTime(item.at)}（北京时间）。每条提交单独保留；关联执行状态不代表这次重试重新执行。</p>
    {intake?.record === null && <p>未取得这条提交记录。请重新检索。</p>}
    {question !== null ? <p className={styles.question}>{question}</p> : <p>此记录没有可显示的提问原文。可展开留存字段核对技术回执或缺失状态。</p>}
    {original != null && <DocumentDetails value={original} label="查看完整提交字段与脱敏类型" />}
    <dl className={styles.identifiers}>
      <dt>当前目录姓名</dt><dd>{item.actorName ?? '姓名未知或目录未匹配'}{item.actorNameTruncated ? '…（名称已缩短）' : ''}</dd>
      <dt>操作账号</dt><dd>{item.actorId}</dd>
      {item.effectiveUserId !== item.actorId && <><dt>有效身份</dt><dd>{item.effectiveUserName ?? '姓名未知或目录未匹配'}{item.effectiveUserNameTruncated ? '…（名称已缩短）' : ''} · {item.effectiveUserId}</dd></>}
      <dt>请求编号</dt><dd>{item.requestId}</dd>
      <dt>提交编号</dt><dd>{item.id}</dd>
    </dl>
    <p className={styles.muted}>姓名取自 {localTime(directoryAsOf)} 的当前人员目录，不是提交时姓名快照；原始账号编号保持不变。</p>
    <button type="button" onClick={exportRecord} disabled={busy}>导出此记录及关联回答（JSON）</button>
    {!stream && <button type="button" onClick={loadStream} disabled={busy}>查看关联回答与来源</button>}
    {stream?.record === null && <p>没有可读取的关联执行记录，无法据此确认是否执行或产生回答。</p>}
    {stream?.record && <>
      <h2>关联回答与来源</h2>
      <p className={styles.muted}>以下为留存的生成结果，按当前界面展示。不能据此证明当时的显示样式、用户已阅读或文件已保存；交付情况以事件记录为准。</p>
      {parsed.success ? <HomeQueryResult result={parsed.data} />
        : <p>{stream.record.archiveState === 'absent' ? '未留存生成回答。' : stream.record.archiveState === 'incomplete_or_invalid' ? '回答快照不完整或校验未通过，不能展示为有效答案。' : '此快照属于其他结果类型，可展开留存内容核对；不重新生成答案。'}</p>}
      {stream.record.archiveState === 'available' && !parsed.success && <DocumentDetails value={stream.record.generatedArchive} label="查看留存结果" />}
      <details className={styles.events}><summary>查看处理与交付事件（{stream.record.events.length} 条）</summary>
        <p className={styles.muted}>当前数据库事件链已校验，尚无独立外部检查点。客户端回执只表示对应软件事件。</p>
        <ol>{stream.record.events.map(event => <li key={event.id}>
          <div className={styles.eventHeading}><strong>{event.sequence}. {eventNames[event.kind] ?? event.kind}</strong><time dateTime={event.at}>{localTime(event.at)}</time></div>
          {event.document != null ? <DocumentDetails value={event.document} /> : <p className={styles.muted}>生成内容见上方快照；分段事件不单独拼成答案。</p>}
        </li>)}</ol>
      </details>
    </>}
  </section>;
}

/** Search is explicit: draft edits are not submitted or stored as audit questions. */
export function AiAuditSearch({ scope }: { scope: AuditScope }) {
  const [draft, setDraft] = React.useState(initialDraft);
  const [page, setPage] = React.useState<AuditList | null>(null);
  const [applied, setApplied] = React.useState<AuditFilter | null>(null);
  const [selected, setSelected] = React.useState<Selected | null>(null);
  const [message, setMessage] = React.useState('请选择时间和条件后检索。每次检索和查看都会留存审计记录。');
  const [busy, setBusy] = React.useState(false);
  const [detailOpen, setDetailOpen] = React.useState(false);
  const generation = React.useRef(0), controller = React.useRef<AbortController | null>(null), composing = React.useRef(false);
  const detail = React.useRef<HTMLDivElement>(null), activeButton = React.useRef<HTMLButtonElement | null>(null);
  const clear = React.useCallback((reason: string) => {
    generation.current++; controller.current?.abort(); controller.current = null;
    setBusy(false); setPage(null); setApplied(null); setSelected(null); setDetailOpen(false); setMessage(reason);
  }, []);
  React.useEffect(() => {
    const hidden = () => { if (document.visibilityState !== 'visible') clear('页面已离开，审计内容已收起。返回后请重新检索以核对权限。'); };
    const pagehide = () => clear('页面已离开，请重新检索。');
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', pagehide);
    return () => { controller.current?.abort(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', pagehide); };
  }, [clear]);
  React.useEffect(() => {
    if (!page) return;
    // No unbounded stale permission display and no silent periodic full-text reads.
    const timer = window.setTimeout(() => clear('本次查看已超过一分钟，内容已收起。请重新检索以核对当前权限。'), 60000);
    return () => window.clearTimeout(timer);
  }, [page, clear]);
  // Complete detail focus in the commit; a pending passive effect could otherwise
  // refocus the closing detail after its trigger has already regained focus.
  React.useLayoutEffect(() => {
    if (detailOpen && selected) { detail.current?.focus({ preventScroll: true }); detail.current?.scrollIntoView?.({ block: 'nearest' }); }
  }, [detailOpen, selected]);

  async function run(work: (signal: AbortSignal) => Promise<void>) {
    controller.current?.abort(); const next = new AbortController(); controller.current = next;
    const ticket = ++generation.current; setBusy(true);
    try { await work(next.signal); }
    catch (error) {
      if (!next.signal.aborted && ticket === generation.current) clear(error instanceof AuditReadError && error.reason === 'export_denied'
        ? '当前账号没有可用的独立审计导出资格，或导出条件已失效。可重新检索查看记录。'
        : error instanceof AuditReadError && error.reason === 'denied'
        ? '当前账号没有可用的审计资格，或本次访问条件已失效。内容已收起，请核对资格后重新检索。'
        : error instanceof AuditReadError && error.reason === 'identity' ? '登录身份已变化，审计内容已收起。请使用本人账号重新进入。'
          : '审计服务暂时不可用或内容无法校验。内容已收起，请稍后重新检索。');
    } finally { if (ticket === generation.current) { setBusy(false); controller.current = null; } }
  }
  function valid(signal: AbortSignal) { signal.throwIfAborted(); if (document.visibilityState !== 'visible') throw new AuditReadError('identity'); }
  function search(next: AuditFilter) {
    setSelected(null); setDetailOpen(false); setPage(null); setMessage('正在核对权限并检索…');
    void run(async signal => { const result = await aiAuditClient.list(scope, next, signal); valid(signal); setPage(result); setApplied(next); setMessage(''); });
  }
  function exportRecords(targets: AuditExportTarget[]) {
    setMessage('正在核对独立导出资格并生成审计文件…');
    void run(async signal => {
      const file = await aiAuditClient.exportRecords(scope, targets, signal); valid(signal);
      const url = URL.createObjectURL(file.blob), anchor = document.createElement('a');
      try { anchor.href = url; anchor.download = file.filename; document.body.appendChild(anchor); anchor.click(); }
      finally { anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 30000); }
      let reported = true;
      try { await aiAuditClient.reportExport(scope, file, signal); } catch { reported = false; }
      valid(signal);
      setMessage(reported ? '浏览器已发起审计文件下载，并记录客户端报告。请自行确认文件是否保存；已下载文件无法远程撤回。'
        : '浏览器已发起下载，但客户端报告未确认。请核对文件；不能据此断定文件未保存。');
    });
  }
  function submit(event: React.FormEvent) {
    event.preventDefault(); if (composing.current) return;
    const parsed = auditFilterSchema.safeParse({ action: 'list', from: inputTimestamp(draft.from), to: inputTimestamp(draft.to),
      ...(draft.actorSearch.trim() ? { actorSearch: draft.actorSearch.trim() } : {}),
      ...(draft.keyword.trim() ? { keyword: draft.keyword.trim() } : {}), ...(draft.actorId.trim() ? { actorId: draft.actorId.trim() } : {}),
      ...(draft.state ? { state: draft.state } : {}), ...(draft.entry ? { entry: draft.entry } : {}) });
    if (!parsed.success || !validRange(parsed.data)) {
      setMessage('时间跨度最多 31 天，结束须晚于开始且不晚于现在；账号编号须为完整 UUID。可以查询历史区间。'); return;
    }
    search(parsed.data);
  }
  function open(item: AuditItem, trigger: HTMLButtonElement) {
    activeButton.current = trigger; setSelected(null); setDetailOpen(false); setMessage('正在读取完整记录…');
    void run(async signal => {
      const value: Selected = item.kind === 'intake' ? { item, intake: await aiAuditClient.intake(scope, item.id, signal) }
        : { item, stream: await aiAuditClient.stream(scope, item.requestId, signal) };
      valid(signal);
      if (value.intake?.record && value.intake.record.requestId !== item.requestId) throw new AuditReadError('unavailable');
      setSelected(value); setDetailOpen(true); setMessage('');
    });
  }
  const field = (key: keyof Draft) => ({ value: draft[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setDraft(current => ({ ...current, [key]: event.target.value })) });
  return <>
    <form className={styles.filters} onSubmit={submit} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
      onKeyDown={event => { if (event.key === 'Enter' && (composing.current || event.nativeEvent.isComposing)) event.preventDefault(); }}>
      <div className={styles.searchRow}><label>提问关键词<input type="search" maxLength={200} placeholder="搜索已提交的提问原文" {...field('keyword')} /></label><button type="submit">{busy ? '重新检索' : '检索记录'}</button></div>
      <div className={styles.filterGrid}>
        <label>开始时间（北京时间）<input type="datetime-local" step="1" required {...field('from')} /></label>
        <label>结束时间（北京时间）<input type="datetime-local" step="1" required {...field('to')} /></label>
        <label>关联执行状态<select {...field('state')}><option value="">全部状态</option>{auditStates.map(state => <option key={state} value={state}>{auditStateLabels[state]}</option>)}</select></label>
        <label>入口<select {...field('entry')}><option value="">全部入口</option>{auditEntries.map(entry => <option key={entry} value={entry}>{auditEntryLabels[entry]}</option>)}</select></label>
      </div>
      <details className={styles.more}><summary>按人员筛选</summary><label>人员姓名<input type="text" maxLength={120} autoComplete="off" placeholder="当前目录中的中英文姓名" {...field('actorSearch')} /></label><label>操作账号 UUID<input type="text" maxLength={36} autoComplete="off" {...field('actorId')} /></label><p className={styles.muted}>姓名按当前目录包含匹配，同名账号分别保留；需要精确筛选时填写完整账号编号。目录改名或缺失时，可通过编号查历史记录。</p></details>
    </form>
    <p role="status" className={styles.status}>{message}</p>
    {page && <section aria-label="检索结果" className={styles.results}>
      <div className={styles.resultHeading}><h2>提交记录</h2><span>本页匹配 {page.items.length} 条，检查 {page.scanned} 条候选</span></div>
      <p className={styles.muted}>时间范围 {applied && localTime(applied.from)} 至 {applied && localTime(applied.to)}。筛选草稿修改后须重新检索。</p>
      <p className={styles.muted}>人员姓名来自 {localTime(page.directoryAsOf)} 的当前目录，不是历史身份快照。{applied?.actorSearch ? ` 当前姓名条件：${applied.actorSearch}。` : ''}{applied?.actorId ? ` 当前账号条件：${applied.actorId}。` : ''}</p>
      {page.items.length > 0 && <details className={styles.more}><summary>导出审计记录</summary>
        <p className={styles.muted}>需独立审计导出资格。仅导出本页匹配记录及其关联回答、来源和事件，不含后续页或原始附件；文件仅供内部审计。</p>
        <button type="button" disabled={busy} onClick={() => exportRecords(page.items.map(item => ({ kind: item.kind, id: item.id })))}>导出本页 {page.items.length} 条（JSON）</button>
      </details>}
      {page.totalUnreadable > 0 && <p>累计 {page.totalUnreadable} 条候选正文缺失或无法校验；关键词检索可能遗漏，不能视为完整结果。</p>}
      {!page.items.length && <p>{page.nextCursor ? '本批候选未匹配，仍有后续记录。请继续检查下一批。' : page.searchComplete ? '已检查当前条件的全部候选，没有匹配记录。' : '本页没有匹配记录，但存在无法检索的正文，不能确认完全没有匹配。'}</p>}
      <ul className={styles.rows}>{page.items.map(item => <li key={item.id}>
        <button className={styles.row} aria-expanded={selected?.item.id === item.id && detailOpen} onClick={event => open(item, event.currentTarget)}>
          <span className={styles.rowMeta}><time dateTime={item.at}>{localTime(item.at)}</time><span>{auditEntryLabels[item.entry]}，{auditStateLabels[item.relatedExecutionState]}</span></span>
          <span className={styles.excerpt}>{item.excerpt ?? '正文缺失或校验不可用'}{item.truncated ? '…（展开全文）' : ''}</span>
          <span className={styles.actor}>{item.actorName ?? '姓名未知或目录未匹配'}{item.actorNameTruncated ? '…（名称已缩短）' : ''} · 账号 {item.actorId.slice(0, 8)}（完整编号见详情）</span>
        </button>
        {applied && applied.actorId !== item.actorId && <button className={styles.personFilter} aria-label={`仅看此账号 ${item.actorId}`} onClick={() => {
          setDraft(current => ({ ...current, actorId: item.actorId, actorSearch: '' }));
          search({ ...applied, actorId: item.actorId, actorSearch: undefined, cursor: undefined });
        }}>仅看此账号</button>}
        {detailOpen && selected?.item.id === item.id && <div ref={detail} tabIndex={-1} className={styles.detailContainer}>
          <button className={styles.close} onClick={() => { setDetailOpen(false); setSelected(null); activeButton.current?.focus(); }}>收起详情</button>
          <RecordDetails selected={selected} directoryAsOf={page.directoryAsOf} busy={busy} exportRecord={() => exportRecords([{ kind: selected.item.kind, id: selected.item.id }])} loadStream={() => {
            const current = selected; setMessage('正在读取关联执行…');
            void run(async signal => { const stream = await aiAuditClient.stream(scope, current.item.requestId, signal); valid(signal); setSelected({ ...current, stream }); setMessage(''); });
          }} />
        </div>}
      </li>)}</ul>
      <div className={styles.pagination}>
        {page.nextCursor && applied && <button onClick={() => search({ ...applied, cursor: page.nextCursor! })}>继续检查下一批</button>}
        {applied?.cursor && <button onClick={() => search({ ...applied, cursor: undefined })}>返回首批</button>}
        {!page.nextCursor && <p>{page.searchComplete ? '当前候选已检查完毕。' : '已到候选末尾，存在正文不可用记录。'}</p>}
      </div>
    </section>}
    <p className={styles.notice}>页面隐藏或本次查看超过一分钟后收起内容；重新检索会再次核对资格。审计导出另需独立资格，不包含原始附件下载或对外发送权限。</p>
  </>;
}

export function AiAuditWorkspace() {
  const { session, status } = useAppSession();
  const { isImpersonating, targetUserId } = useImpersonation();
  const actorId = session?.session.user.id, sessionId = session?.sessionId;
  const allowedIdentity = status === 'authenticated' && isIntelligencePreviewEnabled(session?.role) && actorId && sessionId && session?.user.id === actorId && !isImpersonating && !targetUserId;
  const scope = React.useMemo(() => ({ actorId: actorId ?? '', sessionId: sessionId ?? '' }), [actorId, sessionId]);
  return <main className={styles.workspace}>
    <header className={styles.header}><div><h1>AI 提问审计</h1><p>检索正式提交的问题，核对留存回答、来源与处理过程。</p></div><Link href="/">返回主页</Link></header>
    <div className={styles.body}>
      <p className={styles.access}>仅向经服务器验证并获独立审计资格的 admin 开放。管理员角色本身不授予正文查看权。</p>
      {allowedIdentity ? <AiAuditSearch key={`${actorId}:${sessionId}`} scope={scope} />
        : <p role="status">{status === 'loading' ? '正在核对登录状态…' : isImpersonating || targetUserId ? '模拟身份下不能查看提问审计，请退出模拟后再进入。' : 'AI 功能仅供 admin 使用，请使用获准审计的管理员本人账号进入。'}</p>}
    </div>
  </main>;
}
