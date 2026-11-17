'use client';

import * as React from 'react';
import { ArrowLeft, Plus } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { Input } from '@/src/components/ui/Input';
import type { HistoryEntry, HistoryOpened, HistoryPage } from '@/src/lib/intelligence/query/historyProtocol';
import { queryScopeKey, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { trustedQueryHistoryClient } from '@/src/services/trustedQueryHistoryClient';
import styles from './HomeQueryHistory.module.css';

export type HomeQueryHistoryProps = { scope: QueryClientScope; permissionRevision?: string; refreshKey?: number;
  activeConversationId?: string; busy?: boolean; onNew?: () => void; onHome?: () => void;
  onOpen: (opened: HistoryOpened) => void; onClose?: () => void };
const displayDate = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** Only one page of metadata is mounted. Opening a turn restores one original
 * snapshot; the panel never keeps a list of charts or full response bodies. */
export function HomeQueryHistory(props: HomeQueryHistoryProps) {
  const ownerKey = `${queryScopeKey(props.scope)}:${props.permissionRevision ?? ''}`;
  return <HistoryPanel key={ownerKey} {...props} ownerKey={ownerKey} />;
}

function HistoryPanel({ scope, refreshKey = 0, activeConversationId, busy: queryBusy = false, onNew, onHome, onOpen, onClose, ownerKey }: HomeQueryHistoryProps & { ownerKey: string }) {
  const searchId = React.useId(), titleId = React.useId();
  const stableScope = React.useMemo(() => ({ actorId: scope.actorId, effectiveId: scope.effectiveId,
    sessionId: scope.sessionId, targetId: scope.targetId }), [scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);
  const [search, setSearch] = React.useState(''), [composing, setComposing] = React.useState(false);
  const [archived, setArchived] = React.useState(false), [cursors, setCursors] = React.useState<Array<string | undefined>>([undefined]);
  const [reload, setReload] = React.useState(0), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState<{ owner: string; page: HistoryPage } | null>(null);
  const [thread, setThread] = React.useState<{ owner: string; opened: Omit<HistoryOpened, 'selected' | 'conversation'>; id: string } | null>(null);
  const [editing, setEditing] = React.useState<HistoryEntry | null>(null), [title, setTitle] = React.useState('');
  const active = React.useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const queryEpoch = React.useRef(0);
  const titleComposing = React.useRef(false);
  const page = saved?.owner === ownerKey ? saved.page : null;
  const dateGroups = React.useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of page?.entries ?? []) {
      const date = new Date(entry.updatedAt);
      const label = Number.isFinite(date.getTime())
        ? new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' }).format(date)
        : '日期未记录';
      groups.set(label, [...(groups.get(label) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [page]);
  const visibleThread = thread?.owner === ownerKey ? thread : null;
  const cursor = cursors.at(-1);
  const onOpenRef = React.useRef(onOpen);
  React.useLayoutEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  // A historical open that started before a new live question cannot later
  // replace that question, even if the live request finishes first.
  React.useLayoutEffect(() => { if (queryBusy) queryEpoch.current++; }, [queryBusy]);
  React.useLayoutEffect(() => {
    const requestState = active.current;
    return () => { requestState.generation++; requestState.controller?.abort(); };
  }, []);
  const begin = React.useCallback(() => {
    active.current.controller?.abort();
    const controller = new AbortController(), generation = ++active.current.generation;
    active.current.controller = controller;
    setBusy(true); setError('');
    return { controller, generation, isCurrent: () => !controller.signal.aborted && generation === active.current.generation };
  }, []);
  React.useEffect(() => {
    if (composing) return;
    let request: ReturnType<typeof begin> | undefined;
    const timer = setTimeout(() => {
      request = begin();
      const currentRequest = request;
      void trustedQueryHistoryClient.list(stableScope, { search, archived, ...(cursor ? { cursor } : {}) }, currentRequest.controller.signal)
        .then(value => { if (currentRequest.isCurrent()) setSaved({ owner: ownerKey, page: value }); })
        .catch(reason => { if (currentRequest.isCurrent()) { setSaved(null); setThread(null); setError(reason instanceof Error ? reason.message : '历史工作记录暂不可用。'); } })
        .finally(() => { if (currentRequest.isCurrent()) setBusy(false); });
    }, search ? 250 : 0);
    return () => { clearTimeout(timer); request?.controller.abort(); };
  }, [ownerKey, stableScope, search, composing, archived, cursor, reload, refreshKey, begin]);

  const open = async (conversationId: string, requestId?: string, nextCursor?: string) => {
    if (queryBusy) return;
    const beforeQuestion = queryEpoch.current;
    const request = begin();
    try {
      const opened = await trustedQueryHistoryClient.open(stableScope, { conversationId,
        ...(requestId ? { requestId } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) }, request.controller.signal);
      if (!request.isCurrent() || beforeQuestion !== queryEpoch.current) return;
      // Discard the large result here; the main work surface owns it.
      setThread({ owner: ownerKey, id: conversationId, opened: { title: opened.title, turns: opened.turns,
        hasMore: opened.hasMore, nextCursor: opened.nextCursor } });
      onOpenRef.current(opened);
    } catch (reason) { if (request.isCurrent()) setError(reason instanceof Error ? reason.message : '此工作记录暂不可打开。'); }
    finally { if (request.isCurrent()) setBusy(false); }
  };
  const change = async (entry: HistoryEntry, rename = false) => {
    if (queryBusy) return;
    const request = begin();
    try {
      await trustedQueryHistoryClient.change(stableScope, rename
        ? { action: 'rename', conversationId: entry.conversationId, title }
        : { action: 'archive', conversationId: entry.conversationId, archived: !entry.archived }, request.controller.signal);
      if (!request.isCurrent()) return;
      setEditing(null); setTitle(''); setThread(null); setSaved(null); setReload(value => value + 1);
    } catch (reason) { if (request.isCurrent()) setError(reason instanceof Error ? reason.message : '未保存，请重试。'); }
    finally { if (request.isCurrent()) setBusy(false); }
  };

  return <aside className={styles.panel} aria-label="历史工作记录">
    {(onNew || onHome) && <nav className={styles.navigation} aria-label="对话工作导航">
      {onNew && <Button variant="secondary" disabled={queryBusy} onClick={onNew}><Plus size={16} aria-hidden="true" />新对话</Button>}
      {onHome && <Button variant="ghost" onClick={onHome}><ArrowLeft size={16} aria-hidden="true" />返回主页</Button>}
    </nav>}
    <div className={styles.heading}><h3>历史工作记录</h3>{onClose && <Button variant="ghost" onClick={onClose}>关闭历史</Button>}</div>
    <p className={styles.note}>打开原始回答，继续研究。历史快照保留当时的数据与口径。</p>
    <div className={styles.search}>
      <label htmlFor={searchId}>搜索标题或最近问题</label>
      <Input id={searchId} type="search" value={search} placeholder="项目、区域或分析主题"
        onChange={event => { setSearch(event.target.value); setCursors([undefined]); setThread(null); }}
        onCompositionStart={() => { setComposing(true); setBusy(false); }} onCompositionEnd={() => setComposing(false)} />
      <label className={styles.toggle}><input type="checkbox" checked={archived} onChange={event => {
        setArchived(event.target.checked); setCursors([undefined]); setThread(null); setEditing(null);
      }} />查看已归档记录</label>
    </div>
    <div role="status" aria-live="polite" className={styles.status}>{busy ? '正在读取本人有权访问的工作记录…' : ''}</div>
    {error && <div role="alert" className={styles.error}><p>{error}</p><Button variant="secondary" onClick={() => { setCursors([undefined]); setThread(null); setReload(value => value + 1); }}>重试读取历史</Button></div>}
    {visibleThread && <section className={styles.thread} aria-label="对话中的提问">
      <div className={styles.heading}><h4>{visibleThread.opened.title}</h4><Button variant="ghost" onClick={() => setThread(null)}>收起对话</Button></div>
      <ol className={styles.turns}>{visibleThread.opened.turns.map(turn => <li key={turn.requestId}>
        <button type="button" disabled={busy || queryBusy} onClick={() => void open(visibleThread.id, turn.requestId)} aria-label={`查看记录：${turn.question}`}>
          <span>{turn.question}</span><time dateTime={turn.submittedAt}>{displayDate(turn.submittedAt)}</time>
        </button></li>)}</ol>
      {visibleThread.opened.hasMore && <Button variant="ghost" disabled={busy || queryBusy} onClick={() => void open(visibleThread.id, undefined, visibleThread.opened.nextCursor)}>查看更早提问</Button>}
    </section>}
    {page && !page.entries.length && !busy && <p className={styles.note}>{search ? '本页没有匹配的记录。' : archived ? '本页没有已归档记录。' : '本页暂无可查看的工作记录。'}{page.hasMore ? '可以继续检索下一页。' : ''}</p>}
    {dateGroups.map(([date, entries]) => <section className={styles.dateGroup} key={date} aria-label={`${date}的对话`}>
    <h4 className={styles.dateLabel}>{date}</h4>
    <ul className={styles.entries}>{entries.map(entry => <li key={entry.conversationId} className={`${styles.entry} ${activeConversationId === entry.conversationId ? styles.selected : ''}`}>
      {editing?.conversationId === entry.conversationId ? <form onSubmit={event => { event.preventDefault(); if (!titleComposing.current && title.trim() && !busy) void change(entry, true); }}>
        <label htmlFor={titleId}>对话标题</label><Input id={titleId} value={title} maxLength={120}
          onChange={event => setTitle(event.target.value)} onCompositionStart={() => { titleComposing.current = true; }} onCompositionEnd={() => { titleComposing.current = false; }}
          onKeyDown={event => { if (event.key === 'Enter' && (titleComposing.current || event.nativeEvent.isComposing)) event.preventDefault(); }} />
        <div className={styles.actions}><Button variant="ghost" onClick={() => setEditing(null)}>取消</Button><Button type="submit" disabled={busy || queryBusy || !title.trim()}>保存标题</Button></div>
      </form> : <>
        <button className={styles.open} type="button" disabled={busy || queryBusy} aria-current={activeConversationId === entry.conversationId ? 'true' : undefined} aria-label={`打开对话：${entry.title}`} onClick={() => void open(entry.conversationId)}>
          <strong>{entry.title}</strong><span>{entry.latestQuestion}</span><time dateTime={entry.updatedAt}>{displayDate(entry.updatedAt)}</time>
        </button>
        <div className={styles.actions}><Button variant="ghost" size="sm" disabled={busy || queryBusy} onClick={() => { setEditing(entry); setTitle(entry.title); }}>重命名</Button>
          <Button variant="ghost" size="sm" disabled={busy || queryBusy} onClick={() => void change(entry)}>{entry.archived ? '移回工作记录' : '归档'}</Button></div>
      </>}
    </li>)}</ul></section>)}
    <div className={styles.pagination}>
      {cursors.length > 1 && <Button variant="secondary" disabled={busy} onClick={() => setCursors(value => value.slice(0, -1))}>上一页记录</Button>}
      {page?.hasMore && page.nextCursor && <Button variant="secondary" disabled={busy} onClick={() => { setThread(null); setCursors(value => [...value, page.nextCursor]); }}>下一页记录</Button>}
      {page?.indexing && <Button variant="ghost" disabled={busy} onClick={() => { setCursors([undefined]); setReload(value => value + 1); }}>继续载入早期记录</Button>}
    </div>
    {!!page?.unavailable && <p className={styles.note}>部分历史记录目前无法完整读取，未展示其内容。可以稍后重试。</p>}
    <details className={styles.help}><summary>历史与归档说明</summary><p>重新查询会另行读取数据。归档仅整理本人的列表，不删除原始回答或正式审计记录。</p></details>
  </aside>;
}
