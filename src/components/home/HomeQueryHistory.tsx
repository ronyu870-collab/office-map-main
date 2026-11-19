'use client';

import * as React from 'react';
import { Archive, ArchiveRestore, ArrowLeft, ChevronLeft, ChevronRight, CircleHelp, History, MoreHorizontal, Pencil, Plus, Search, X } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { IconButton } from '@/src/components/ui/IconButton';
import { Input } from '@/src/components/ui/Input';
import type { HistoryEntry, HistoryOpened, HistoryPage, HistoryTurn } from '@/src/lib/intelligence/query/historyProtocol';
import { queryScopeKey, type QueryClientScope } from '@/src/services/trustedQueryClient';
import { trustedQueryHistoryClient } from '@/src/services/trustedQueryHistoryClient';
import styles from './HomeQueryHistory.module.css';

export type HomeQueryHistoryProps = { scope: QueryClientScope; permissionRevision?: string; refreshKey?: number; contextEpoch?: number;
  activeConversationId?: string; activeRequestId?: string; busy?: boolean; onNew?: () => void; onHome?: () => void;
  onOpen: (opened: HistoryOpened) => void; onClose?: () => void };
const displayDate = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai',
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

/** Relative groups use Beijing calendar days, including near UTC midnight. */
export function historyDateLabel(value: string, now = new Date()): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '日期未记录';
  const day = (input: Date) => Math.floor((input.getTime() + 8 * 60 * 60 * 1000) / 86400000);
  const elapsed = day(now) - day(date);
  if (elapsed === 0) return '今天';
  if (elapsed === 1) return '昨天';
  if (elapsed > 1 && elapsed < 7) return '近7天';
  if (elapsed >= 7 && elapsed < 30) return '近30天';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long' }).format(date);
}

type ThreadIndex = { owner: string; id: string; title: string; turns: HistoryTurn[]; selectedId: string;
  hasMore: boolean; nextCursor?: string; timeline: boolean };

/** The sidebar retains one lightweight index page; the main conversation owns
 * restored answers, charts and source snapshots. */
export function HomeQueryHistory(props: HomeQueryHistoryProps) {
  const ownerKey = `${queryScopeKey(props.scope)}:${props.permissionRevision ?? ''}`;
  return <HistoryPanel key={ownerKey} {...props} ownerKey={ownerKey} />;
}

function HistoryPanel({ scope, refreshKey = 0, contextEpoch = 0, activeConversationId, activeRequestId, busy: queryBusy = false, onNew, onHome, onOpen, onClose, ownerKey }: HomeQueryHistoryProps & { ownerKey: string }) {
  const searchId = React.useId(), titleId = React.useId(), tabsId = React.useId(), helpId = React.useId();
  const stableScope = React.useMemo(() => ({ actorId: scope.actorId, effectiveId: scope.effectiveId,
    sessionId: scope.sessionId, targetId: scope.targetId }), [scope.actorId, scope.effectiveId, scope.sessionId, scope.targetId]);
  const [search, setSearch] = React.useState(''), [composing, setComposing] = React.useState(false);
  const [archived, setArchived] = React.useState(false), [cursors, setCursors] = React.useState<Array<string | undefined>>([undefined]);
  const [reload, setReload] = React.useState(0), [busy, setBusy] = React.useState(false), [error, setError] = React.useState('');
  const [saved, setSaved] = React.useState<{ owner: string; page: HistoryPage } | null>(null);
  const [thread, setThread] = React.useState<ThreadIndex | null>(null);
  const [editing, setEditing] = React.useState<HistoryEntry | null>(null), [title, setTitle] = React.useState('');
  const [menuId, setMenuId] = React.useState<string | null>(null), [helpOpen, setHelpOpen] = React.useState(false);
  const [shownContextEpoch, setShownContextEpoch] = React.useState(contextEpoch);
  // Reset only context-bound UI before rendering children. Keeping this same
  // component retains the search field, selection and composition state.
  if (shownContextEpoch !== contextEpoch) {
    setShownContextEpoch(contextEpoch); setBusy(false); setThread(null); setMenuId(null);
  }
  const panel = React.useRef<HTMLElement>(null), scrollArea = React.useRef<HTMLDivElement>(null);
  const titleForm = React.useRef<HTMLFormElement>(null);
  const restoreEntry = React.useRef<string | null>(null);
  const active = React.useRef<{ generation: number; controller?: AbortController }>({ generation: 0 });
  const queryEpoch = React.useRef(0), titleComposing = React.useRef(false);
  const page = saved?.owner === ownerKey ? saved.page : null;
  React.useLayoutEffect(() => {
    if (editing) { const input = titleForm.current?.querySelector('input'); input?.focus(); input?.select(); }
  }, [editing]);
  React.useLayoutEffect(() => {
    if (editing || busy || !page || !restoreEntry.current) return;
    const trigger = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('[data-history-actions]') ?? [])
      .find(button => button.dataset.historyActions === restoreEntry.current);
    const focused = document.activeElement;
    if (focused?.isConnected && focused !== document.body && focused !== trigger) {
      restoreEntry.current = null; return;
    }
    const destination = trigger ?? panel.current?.querySelector<HTMLInputElement>('input[type="search"]');
    destination?.focus({ preventScroll: true }); restoreEntry.current = null;
  }, [editing, page, busy]);
  const dateGroups = React.useMemo(() => {
    const groups = new Map<string, HistoryEntry[]>();
    for (const entry of page?.entries ?? []) {
      const label = historyDateLabel(entry.updatedAt);
      groups.set(label, [...(groups.get(label) ?? []), entry]);
    }
    return [...groups.entries()];
  }, [page]);
  const visibleThread = thread?.owner === ownerKey ? thread : null;
  const cursor = cursors.at(-1);
  const onOpenRef = React.useRef(onOpen);
  React.useLayoutEffect(() => { onOpenRef.current = onOpen; }, [onOpen]);
  React.useLayoutEffect(() => { if (queryBusy) queryEpoch.current++; }, [queryBusy]);
  React.useLayoutEffect(() => {
    const requestState = active.current;
    // Explicit context resets invalidate pending opens without replacing the
    // retained search/editor tree. The index reload keeps the same filters.
    return () => { requestState.generation++; requestState.controller?.abort(); };
  }, [contextEpoch]);
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
  }, [ownerKey, stableScope, search, composing, archived, cursor, reload, refreshKey, contextEpoch, begin]);

  const open = async (conversationId: string, requestId?: string, nextCursor?: string) => {
    if (queryBusy) return;
    const beforeQuestion = queryEpoch.current;
    const request = begin();
    try {
      const opened = await trustedQueryHistoryClient.open(stableScope, { conversationId,
        includeTimeline: true,
        ...(requestId ? { requestId } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) }, request.controller.signal);
      if (!request.isCurrent() || beforeQuestion !== queryEpoch.current) return;
      setThread(current => {
        const sameThread = current?.owner === ownerKey && current.id === conversationId;
        const turns = new Map((sameThread && requestId ? current.turns : []).map(turn => [turn.requestId, turn]));
        opened.turns.forEach(turn => turns.set(turn.requestId, turn));
        return { owner: ownerKey, id: conversationId, title: opened.title, turns: [...turns.values()], selectedId: opened.selected.requestId,
          hasMore: opened.hasMore, nextCursor: opened.nextCursor, timeline: !!opened.timeline || !!(sameThread && current.timeline) };
      });
      setMenuId(null); onOpenRef.current(opened);
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
  const cancelPending = () => { active.current.controller?.abort(); active.current.generation++; setBusy(false); };
  const leave = (callback: () => void) => { cancelPending(); setThread(null); setMenuId(null); callback(); };
  const filter = (nextArchived: boolean) => {
    cancelPending(); setArchived(nextArchived); setCursors([undefined]); setThread(null); setEditing(null); setMenuId(null);
  };
  const updateSearch = (value: string) => {
    cancelPending(); setSearch(value); setCursors([undefined]); setThread(null); setMenuId(null); setEditing(null);
  };

  return <aside ref={panel} className={styles.panel} aria-label="历史工作记录" onFocusCapture={event => {
    if (!restoreEntry.current || titleForm.current?.contains(event.target)) return;
    if (event.target instanceof HTMLElement && event.target.dataset.historyActions === restoreEntry.current) return;
    restoreEntry.current = null;
  }}>
    <div className={styles.header}>
      <div className={styles.heading}><h3><History size={16} aria-hidden="true" />历史记录</h3>{onClose && <IconButton variant="ghost" label="关闭历史" onClick={() => leave(onClose)}><X size={16} aria-hidden="true" /></IconButton>}</div>
      {(onNew || onHome) && <nav className={styles.navigation} aria-label="对话工作导航">
        {onNew && <Button className={styles.newConversation} variant="secondary" disabled={queryBusy} onClick={() => leave(onNew)}><Plus size={16} aria-hidden="true" />新对话</Button>}
        {onHome && <IconButton variant="ghost" label="返回主页" onClick={() => leave(onHome)}><ArrowLeft size={16} aria-hidden="true" /></IconButton>}
      </nav>}
      <div className={styles.search}>
        <label htmlFor={searchId} className="sr-only">搜索标题或最近问题</label>
        <Search className={styles.searchIcon} size={16} aria-hidden="true" />
        <Input id={searchId} type="search" value={search} placeholder="搜索历史对话" autoComplete="off"
          onChange={event => updateSearch(event.target.value)}
          onCompositionStart={() => { cancelPending(); setComposing(true); }} onCompositionEnd={() => setComposing(false)} />
        {search && <IconButton className={styles.clearSearch} variant="ghost" label="清空历史搜索" onClick={() => {
          updateSearch(''); panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
        }}><X size={14} aria-hidden="true" /></IconButton>}
      </div>
      <div className={styles.tabs} role="tablist" aria-label="历史记录范围" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? false : event.key === 'End' ? true : !archived;
        filter(next); event.currentTarget.querySelector<HTMLButtonElement>(`[data-archived="${next}"]`)?.focus();
      }}>
        {[false, true].map(value => <button key={String(value)} type="button" role="tab" id={`${tabsId}-${value}`} data-archived={value}
          aria-selected={archived === value} aria-controls={`${tabsId}-panel`} tabIndex={archived === value ? 0 : -1} onClick={() => filter(value)}>
          {value && <Archive size={14} aria-hidden="true" />}{value ? '已归档' : '最近对话'}
        </button>)}
      </div>
      <div role="status" aria-live="polite" className={styles.status}>{busy ? '正在读取历史记录…' : ''}</div>
    </div>
    <div ref={scrollArea} className={styles.scrollArea} data-history-scroll role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${archived}`}>
      {error && <div role="alert" className={styles.error}><p>{error}</p><Button variant="secondary" onClick={() => { setCursors([undefined]); setThread(null); setReload(value => value + 1); }}>重试读取历史</Button></div>}
      {busy && !page && !error && <div className={styles.skeleton} aria-hidden="true">{Array.from({ length: 5 }, (_, index) => <span key={index} />)}</div>}
      {visibleThread ? <section className={styles.thread} aria-label="对话中的提问">
        <Button variant="ghost" className={styles.backToList} onClick={() => setThread(null)}><ChevronLeft size={16} aria-hidden="true" />全部对话</Button>
        <h4>{visibleThread.title}</h4>
        <p className={styles.note}>点击提问可定位对应回答。</p>
        <ol className={styles.turns}>{visibleThread.turns.map(turn => <li key={turn.requestId}>
          <button type="button" disabled={busy || queryBusy} onClick={() => void open(visibleThread.id, turn.requestId)}
            aria-current={(activeRequestId ?? visibleThread.selectedId) === turn.requestId ? 'step' : undefined} aria-label={`查看记录：${turn.question}`}>
            <span>{turn.question}</span><time dateTime={turn.submittedAt}>{displayDate(turn.submittedAt)}</time>
          </button></li>)}</ol>
        {!visibleThread.timeline && visibleThread.hasMore && <Button variant="ghost" disabled={busy || queryBusy} onClick={() => void open(visibleThread.id, undefined, visibleThread.nextCursor)}>查看更早提问</Button>}
      </section> : <>
        {page && !page.entries.length && !busy && <div className={styles.empty}>
          {archived ? <Archive size={24} aria-hidden="true" /> : <Search size={24} aria-hidden="true" />}
          <p>{search ? '没有找到匹配的对话' : archived ? '还没有归档对话' : '还没有历史对话'}</p>
          <span>{search ? page.hasMore ? '当前页没有匹配结果，可以继续查找更早的记录。' : '换个关键词，或清空搜索后查看全部对话。' : archived ? '归档后，对话会保存在这里。' : '发起一次对话后，可以在这里继续查看。'}</span>
          {search && <Button variant="ghost" onClick={() => { updateSearch(''); panel.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus(); }}>清空搜索</Button>}
        </div>}
        {dateGroups.map(([date, entries]) => <section className={styles.dateGroup} key={date} aria-label={`${date}的对话`}>
          <h4 className={styles.dateLabel}>{date}</h4>
          <ul className={styles.entries}>{entries.map(entry => <li key={entry.conversationId} className={`${styles.entry} ${activeConversationId === entry.conversationId ? styles.selected : ''}`} data-menu-open={menuId === entry.conversationId}>
            {editing?.conversationId === entry.conversationId ? <form ref={titleForm} onSubmit={event => { event.preventDefault(); if (!titleComposing.current && title.trim() && !busy) void change(entry, true); }}>
              <label htmlFor={titleId}>对话标题</label><Input id={titleId} value={title} maxLength={120}
                onChange={event => setTitle(event.target.value)} onCompositionStart={() => { titleComposing.current = true; }} onCompositionEnd={() => { titleComposing.current = false; }}
                onKeyDown={event => { if (event.key === 'Enter' && (titleComposing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229)) event.preventDefault(); }} />
              <div className={styles.actions}><Button variant="ghost" onClick={() => { restoreEntry.current = entry.conversationId; setEditing(null); }}>取消</Button><Button type="submit" disabled={busy || queryBusy || !title.trim()}>保存标题</Button></div>
            </form> : <>
              <button className={styles.open} type="button" disabled={busy || queryBusy} aria-current={activeConversationId === entry.conversationId ? 'true' : undefined} aria-label={`打开对话：${entry.title}`} onClick={() => void open(entry.conversationId)}>
                <strong>{entry.title}</strong>{search && <span>{entry.latestQuestion}</span>}<time className="sr-only" dateTime={entry.updatedAt}>{displayDate(entry.updatedAt)}</time>
              </button>
              <HistoryEntryActions entry={entry} open={menuId === entry.conversationId} disabled={busy || queryBusy}
                onToggle={next => setMenuId(next ? entry.conversationId : null)}
                onRename={() => { setMenuId(null); restoreEntry.current = entry.conversationId; setEditing(entry); setTitle(entry.title); }}
                onArchive={() => { setMenuId(null); restoreEntry.current = entry.conversationId; void change(entry); }} />
            </>}
          </li>)}</ul>
        </section>)}
        <div className={styles.pagination}>
          {cursors.length > 1 && <Button variant="ghost" disabled={busy} onClick={() => { setMenuId(null); setCursors(value => value.slice(0, -1)); scrollArea.current?.scrollTo?.({ top: 0 }); }}><ChevronLeft size={16} aria-hidden="true" />上一页记录</Button>}
          {page?.hasMore && page.nextCursor && <Button variant="ghost" disabled={busy} onClick={() => { setMenuId(null); setCursors(value => [...value, page.nextCursor]); scrollArea.current?.scrollTo?.({ top: 0 }); }}>下一页记录<ChevronRight size={16} aria-hidden="true" /></Button>}
        </div>
        {page?.indexing && <div className={styles.legacy}><p>还有早期对话尚未收录到列表。</p><Button variant="ghost" disabled={busy} onClick={() => { setCursors([undefined]); setReload(value => value + 1); }}>继续收录早期对话</Button></div>}
      </>}
      {!!page?.unavailable && <p className={styles.note}>部分历史记录暂时无法读取，请稍后重试。</p>}
    </div>
    <div className={styles.footer}>
      <button className={styles.helpToggle} type="button" aria-expanded={helpOpen} aria-controls={helpId} onClick={() => setHelpOpen(value => !value)}><CircleHelp size={14} aria-hidden="true" />历史与归档说明</button>
      {helpOpen && <p id={helpId} className={styles.help}>历史保留当时的数据与口径；重新查询会读取最新授权数据。归档只整理列表，不删除原始回答或审计记录。</p>}
    </div>
  </aside>;
}

/** Anchored overlay keeps row positions stable and flips above the trigger near
 * the scrolling viewport edge. All actions remain inside the active dialog. */
function HistoryEntryActions({ entry, open, disabled, onToggle, onRename, onArchive }: {
  entry: HistoryEntry; open: boolean; disabled: boolean;
  onToggle: (open: boolean) => void; onRename: () => void; onArchive: () => void;
}) {
  const id = React.useId();
  const trigger = React.useRef<HTMLButtonElement>(null), root = React.useRef<HTMLDivElement>(null), menu = React.useRef<HTMLDivElement>(null);
  const [above, setAbove] = React.useState(false);
  const onToggleRef = React.useRef(onToggle);
  React.useLayoutEffect(() => { onToggleRef.current = onToggle; }, [onToggle]);
  React.useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onToggleRef.current(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  function toggle(next: boolean) {
    if (next) {
      const box = trigger.current?.getBoundingClientRect(), viewport = root.current?.closest('[data-history-scroll]')?.getBoundingClientRect();
      const panelBox = root.current?.closest('aside')?.getBoundingClientRect();
      const bottom = Math.min(viewport?.bottom ?? window.innerHeight, panelBox?.bottom ?? window.innerHeight);
      const top = Math.max(viewport?.top ?? 0, panelBox?.top ?? 0);
      setAbove(!!box && box.bottom + 112 > bottom && box.top - 112 >= top);
    }
    onToggle(next);
  }
  function close() { onToggle(false); trigger.current?.focus({ preventScroll: true }); }
  return <div ref={root} className={styles.entryActions} onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) onToggle(false);
  }} onKeyDown={event => {
    if (!open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]?.focus({ preventScroll: true });
  }}>
    <IconButton ref={trigger} className={styles.more} variant="ghost" label={`对话操作：${entry.title}`} title="更多操作"
      data-history-actions={entry.conversationId} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => toggle(!open)} onKeyDown={event => {
        if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) { event.preventDefault(); toggle(true); }
      }}><MoreHorizontal size={16} aria-hidden="true" /></IconButton>
    {open && <div ref={menu} id={id} className={styles.entryMenu} data-above={above} role="menu" aria-label={`对话操作：${entry.title}`}>
      <Button variant="ghost" role="menuitem" tabIndex={-1} disabled={disabled} onClick={onRename}><Pencil size={14} aria-hidden="true" />重命名</Button>
      <Button variant="ghost" role="menuitem" tabIndex={-1} disabled={disabled} onClick={onArchive}>{entry.archived ? <ArchiveRestore size={14} aria-hidden="true" /> : <Archive size={14} aria-hidden="true" />}{entry.archived ? '移回工作记录' : '归档'}</Button>
    </div>}
  </div>;
}
