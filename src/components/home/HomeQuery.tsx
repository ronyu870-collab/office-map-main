'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ArrowUp, ArrowUpRight, ArrowDown, Square, History, Maximize2, Minimize2, PanelRight, Plus, ArrowLeft } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, queryScopeKey, type QueryAccess, type QueryClientScope, type QueryReply } from '@/src/services/trustedQueryClient';
import { queryActionSchema, type QueryAction, type QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';
import { HomeQueryResult } from './HomeQueryResult';
import { resultSummary } from '@/src/lib/intelligence/query/presentation';
import { QueryWelcome, AssistantHeading, QueryWorkingIndicator } from './HomeQueryExperience';
import { QueryClientError, queryFailureMessage } from '@/src/services/queryClientErrors';
import { readMapQueryContext, type BuildingSelection } from '@/src/lib/intelligence/query/buildingNavigation';
import type { HistoryOpened } from '@/src/lib/intelligence/query/historyProtocol';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import { useQueryWorkspace, useQueryScroll } from './useQueryWorkspace';
import styles from './HomeQuery.module.css';
import workspaceStyles from './HomeQueryWorkspace.module.css';

const HomeQueryHistory = dynamic(() => import('./HomeQueryHistory').then(module => module.HomeQueryHistory), {
  loading: () => <p role="status">正在打开历史记录…</p>,
});
const HomeQueryResearchPanel = dynamic(() => import('./HomeQueryResearchPanel').then(module => module.HomeQueryResearchPanel), {
  loading: () => <p role="status">正在打开研究资料…</p>,
});
type Attempt = { idempotencyKey: string; question: string; requestId?: string; conversation?: QueryConversation; buildingSelection?: BuildingSelection; replayRequestId?: string };
type Turn = { attempt: Attempt; reply: QueryReply | null; message: string };
const CLOSED: QueryAccess = { enabled: false, examples: [] };

/** A different verified identity must never inherit even in-memory questions. */
export function HomeQuery({ scope, displayName }: { scope: QueryClientScope; displayName?: string }) {
  return <HomeQuerySession key={queryScopeKey(scope)} scope={scope} displayName={displayName} />;
}
function HomeQuerySession({ scope, displayName }: { scope: QueryClientScope; displayName?: string }) {
  const [access, setAccess] = React.useState<QueryAccess>(CLOSED);
  const [accessError, setAccessError] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [reply, setReply] = React.useState<QueryReply | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [terminalFailure, setTerminalFailure] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [examplesOpen, setExamplesOpen] = React.useState(false);
  const [history, setHistory] = React.useState<Turn[]>([]);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [conversationId, setConversationId] = React.useState(() => crypto.randomUUID());
  const [parentRequest, setParentRequest] = React.useState<string | undefined>(undefined);
  const [resumedContext, setResumedContext] = React.useState<QueryConversation | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [compactHistoryOpen, setCompactHistoryOpen] = React.useState(false);
  const [historyMounted, setHistoryMounted] = React.useState(false);
  const [researchOpen, setResearchOpen] = React.useState(false);
  const [researchMounted, setResearchMounted] = React.useState(false);
  const [historyRefresh, setHistoryRefresh] = React.useState(0);
  const [buildingSelection, setBuildingSelection] = React.useState<BuildingSelection | null>(null);
  const navigationConsumed = React.useRef<string | null>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const composing = React.useRef(false), alive = React.useRef(true);
  const { anchor: workspaceAnchorRef, surface: workspaceSurfaceRef, scroller: workspaceScrollRef,
    toggle: workspaceToggleRef, expanded, floating, transitioning, expand: enterWorkspace, collapse: exitWorkspace,
    clearComposition: clearWorkspaceComposition } = useQueryWorkspace(composing);
  const scroll = useQueryScroll(workspaceScrollRef,
    `${attempt?.idempotencyKey ?? ''}:${busy}:${message}:${reply?.status ?? ''}:${reply?.result?.resultId ?? ''}`,
    transitioning);
  const historyToggle = React.useRef<HTMLButtonElement>(null);
  const researchToggle = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (!expanded || !historyOpen || !researchOpen || !window.matchMedia) return;
    const wide = window.matchMedia('(min-width: 1280px)');
    const fitPanels = () => {
      if (wide.matches) return;
      // Preserve the focused editor (including an active IME). Otherwise keep
      // the explicitly opened research panel and its current reading context.
      const historyHasFocus = workspaceSurfaceRef.current?.querySelector('#query-workspace-history')?.contains(document.activeElement);
      if (historyHasFocus) setResearchOpen(false);
      else { setHistoryOpen(false); setCompactHistoryOpen(false); }
    };
    fitPanels();
    wide.addEventListener('change', fitPanels);
    return () => wide.removeEventListener('change', fitPanels);
  }, [expanded, historyOpen, researchOpen, workspaceSurfaceRef]);
  const current = React.useRef<AbortController | null>(null);
  const generation = React.useRef(0), revision = React.useRef<string | undefined>(undefined);
  useQueryPresentationReceipt(scope, reply, access.enabled && reply?.status === 'clarification' ? { surface: 'clarification' } : null);
  const storageKey = `trusted-query:last:${queryScopeKey(scope)}`;
  const clearSaved = React.useCallback(() => { setSavedId(null); try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }, [storageKey]);
  const resetConversation = React.useCallback((clearDraft = true) => {
    generation.current++; current.current?.abort(); current.current = null;
    setParentRequest(undefined); setConversationId(crypto.randomUUID());
    setResumedContext(null); setBuildingSelection(null); setResearchOpen(false);
    setBusy(false); setTerminalFailure(false); setReply(null); setAttempt(null); setHistory([]); setCollapsed(false); setMessage('');
    if (clearDraft) {
      setDraft(''); composing.current = false; clearWorkspaceComposition(); exitWorkspace();
      setHistoryOpen(false); setCompactHistoryOpen(false); setHistoryMounted(false); setResearchMounted(false);
    }
    clearSaved();
  }, [clearSaved, exitWorkspace, clearWorkspaceComposition]);

  React.useEffect(() => {
    alive.current = true; generation.current++;
    let previous: AbortController | null = null;
    let initialId: string | null = null, first = true;
    try { const id = sessionStorage.getItem(storageKey); if (id && /^[0-9a-f-]{36}$/.test(id)) initialId = id; } catch { /* Never persist query text or results. */ }
    const refresh = async () => {
      previous?.abort(); const controller = new AbortController(); previous = controller;
      try {
        const value = await trustedQueryClient.capabilities(scope, controller.signal);
        if (controller.signal.aborted || !alive.current) return;
        const changed = revision.current && value.permissionRevision !== revision.current;
        revision.current = value.permissionRevision;
        setAccess(value); setAccessError(false);
        if (first && value.enabled && !changed) setSavedId(initialId);
        first = false;
        if (!value.enabled || changed) {
          resetConversation();
          if (changed) setMessage('查询权限已变化，旧结果已收起，请重新查询。');
        }
      } catch {
        if (controller.signal.aborted || !alive.current) return;
        setAccess(CLOSED); setAccessError(true); resetConversation();
      }
    };
    void refresh();
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const timer = window.setInterval(focus, 30000);
    return () => { alive.current = false; previous?.abort(); current.current?.abort(); current.current = null; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [scope, storageKey, resetConversation]);
  React.useEffect(() => {
    const node = input.current;
    if (node) { node.style.height = 'auto'; node.style.height = `${Math.max(56, Math.min(node.scrollHeight, 200))}px`; }
  }, [draft, access.enabled]);

  const run = React.useCallback(async (next: Attempt, recovering = false) => {
    if (current.current || !access.enabled || composing.current) return;
    const controller = new AbortController(); current.current = controller;
    const ticket = ++generation.current;
    if (!recovering && next.idempotencyKey !== attempt?.idempotencyKey) {
      if (attempt) setHistory(items => [...items, { attempt, reply, message }]);
      // An interrupted new query must not restore the previous question's ID.
      clearSaved();
    }
    setBusy(true); setTerminalFailure(false); setCollapsed(false); setMessage(recovering ? '正在核对权限并恢复结果…' : '正在处理你的问题…'); setReply(null); setAttempt(next);
    setBuildingSelection(null);
    try {
      const result = recovering && next.requestId ? await trustedQueryClient.recover(scope, next.requestId, controller.signal)
        : await trustedQueryClient.submit(scope, { idempotencyKey: next.idempotencyKey, question: next.question, ...(next.conversation ? { conversation: next.conversation } : {}), ...(next.buildingSelection ? { buildingSelection: next.buildingSelection } : {}), ...(next.replayRequestId ? { replayRequestId: next.replayRequestId } : {}) }, controller.signal);
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      const updated = { ...next, requestId: result.requestId ?? next.requestId }; setAttempt(updated);
      // Capacity rejection and a confirmed failed recovery are terminal for
      // this request key. A smaller edited question gets its own new key.
      const historyExpired = result.status === 'failed' && result.reason === 'history_reopen';
      const terminal = result.status === 'failed' && (result.reason === 'scope_limit' || historyExpired || recovering);
      setTerminalFailure(terminal);
      if (historyExpired) { setResumedContext(null); setParentRequest(undefined); setConversationId(crypto.randomUUID()); }
      if (terminal) clearSaved();
      else if (updated.requestId) {
        setSavedId(updated.requestId); try { sessionStorage.setItem(storageKey, updated.requestId); } catch { /* Recovery also works in this mounted session. */ }
      }
      if (result.status === 'denied') {
        setAccess(CLOSED); resetConversation();
        setMessage(result.error ?? '当前查询资格已不可用，请重新核对权限。');
        return;
      }
      setReply(result);
      setHistoryRefresh(value => value + 1);
      // Only completed, attributed turns become parents. A restored old request
      // without this page's conversation cannot silently seed a new dialogue.
      const responseConversation = result.conversation ?? next.conversation;
      if ((result.status === 'ready' || result.status === 'clarification') && result.requestId
        && responseConversation && responseConversation.id === next.conversation?.id) { setConversationId(responseConversation.id); setParentRequest(result.requestId); setResumedContext(null); }
      if (result.status === 'ready' && result.result) setMessage('查询完成。');
      else if (historyExpired) setMessage('此历史上下文已过期，请重新打开历史记录后继续分析。也可以开始一个新问题。');
      else if (terminal) setMessage(result.reason === 'scope_limit'
        ? result.error ?? '本次查询范围超过交互容量，请减少子市场、季度或指标后重新提问。'
        : '本次请求未生成可恢复的结果，请修改问题后重新提交。');
      else if (result.status === 'clarification') { setMessage(result.message ?? '请补充完整查询条件。'); clearSaved(); }
      else if (result.status === 'running' || result.status === 'received') setMessage('请求已接收，服务端仍在处理。可检查状态并恢复原结果；不会重新查数。');
      else if (['already_received', 'succeeded', 'changed'].includes(result.status)) setMessage('请求已接收，可检查状态并恢复原结果；不会重新查数。');
      else if (result.status === 'unavailable') setMessage('查询服务暂时不可用，不能据此判断没有数据。可稍后检查状态或重试本次请求。');
      else { setMessage(result.error ?? '本次请求没有可恢复的结果，请检查权限或修改条件后重新查询。'); if (result.status === 'denied') clearSaved(); }
    } catch (error) {
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      if (error instanceof QueryClientError && error.kind === 'identity') { setAccess(CLOSED); resetConversation(); }
      setMessage(queryFailureMessage(error));
    } finally {
      if (current.current === controller) current.current = null;
      if (alive.current && ticket === generation.current) setBusy(false);
    }
  }, [access.enabled, attempt, reply, message, clearSaved, resetConversation, scope, storageKey]);
  function stopWaiting() {
    generation.current++; current.current?.abort(); current.current = null; setBusy(false);
    setMessage('已停止等待，服务端可能仍在处理。可重试本次请求或恢复结果，不能据此认定服务端已取消。');
  }
  const edit = React.useCallback((question: string) => { setDraft(question); input.current?.focus(); }, []);
  function newAttempt(question: string, parent = parentRequest): Attempt {
    return { idempotencyKey: crypto.randomUUID(), question,
      ...(buildingSelection ? { buildingSelection } : {}),
      conversation: { id: conversationId, ...(parent ? { parentRequestId: parent } : {}),
        ...(resumedContext?.parentRequestId === parent && resumedContext?.resumeToken ? { resumeToken: resumedContext.resumeToken } : {}) } };
  }
  function submitDraft() {
    if (!draft.trim() || busy || current.current || !access.enabled || composing.current) return;
    const submitted = draft;
    scroll.followNext();
    void run(newAttempt(submitted));
    // Clear only this synchronous submit, never a later draft on response arrival.
    setDraft(''); input.current?.focus();
  }
  function followUp(action: QueryAction, turn: Turn) {
    const source = turn.reply?.conversation ?? turn.attempt.conversation;
    if (!turn.reply?.requestId || source?.id !== conversationId) return;
    const next = newAttempt(action.question, turn.reply.requestId);
    if (turn.attempt.conversation?.parentRequestId === turn.reply.requestId && turn.attempt.conversation.resumeToken) {
      next.conversation = { id: conversationId, parentRequestId: turn.reply.requestId, resumeToken: turn.attempt.conversation.resumeToken };
    }
    scroll.followNext(); void run(next);
  }
  function reexecute() {
    if (!attempt?.requestId || busy) return;
    const id = crypto.randomUUID();
    setConversationId(id); setParentRequest(undefined); setResumedContext(null);
    // The server reauthorizes the archived executed plan. In particular, a
    // relative question such as "去年同期" must not shift its dates a second time.
    void run({ idempotencyKey: crypto.randomUUID(), question: attempt.question,
      conversation: { id }, replayRequestId: attempt.requestId });
  }
  const openHistory = React.useCallback((opened: HistoryOpened) => {
    generation.current++; current.current?.abort(); current.current = null;
    const selected = opened.selected;
    setBusy(false); setTerminalFailure(false); setHistory([]); setCollapsed(false);
    setConversationId(opened.conversation.id); setParentRequest(opened.conversation.parentRequestId); setResumedContext(opened.conversation);
    setAttempt({ idempotencyKey: crypto.randomUUID(), question: selected.question, requestId: selected.requestId, conversation: opened.conversation });
    setReply(selected.reply); setMessage(selected.reply.status === 'ready' ? '已打开原始历史快照，未重新查询。' : selected.reply.message ?? selected.reply.error ?? '已打开历史工作记录。');
    setDraft(''); setBuildingSelection(null); setSavedId(selected.requestId);
    try { sessionStorage.setItem(storageKey, selected.requestId); } catch { /* Only an opaque request reference is stored. */ }
  }, [storageKey]);
  React.useEffect(() => {
    if (!access.enabled) return;
    const search = window.location.search;
    if (navigationConsumed.current === search) return;
    navigationConsumed.current = search;
    const params = new URLSearchParams(search);
    const incoming = readMapQueryContext(params);
    // Consume this external URL once, after the server-confirmed capability check.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (incoming) { setBuildingSelection(incoming.selection); setDraft(incoming.question); input.current?.focus(); return; }
    const requestId = params.get('aiRequest');
    if (!requestId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId) || current.current) return;
    const controller = new AbortController(), ticket = ++generation.current;
    current.current = controller; setBusy(true); setMessage('正在核对权限并恢复地图关联的原始记录…');
    void import('@/src/services/trustedQueryHistoryClient').then(module => module.trustedQueryHistoryClient.open(scope, { requestId }, controller.signal))
      .then(opened => {
        if (alive.current && ticket === generation.current && !controller.signal.aborted) openHistory(opened);
      }).catch(() => {
        if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
        // Older deployments may not have conversation metadata yet. The original
        // same-session recovery independently checks ownership/ACLs; it never reruns.
        current.current = null;
        void run({ idempotencyKey: crypto.randomUUID(), question: '', requestId }, true);
      }).finally(() => {
        if (current.current === controller) current.current = null;
        if (alive.current && ticket === generation.current) setBusy(false);
      });
  }, [access.enabled, run, openHistory, scope]);
  const activeTurn: Turn | null = attempt ? { attempt, reply, message } : null;
  const activeContext = !!attempt && !!reply?.requestId && (reply.conversation ?? attempt.conversation)?.id === conversationId;
  const ready = reply?.status === 'ready' && !!reply.result;
  const assistantHelp = reply?.status === 'clarification' && reply.reason === 'assistant_help';
  const needsConditions = reply?.status === 'clarification' && !assistantHelp;
  const retry = attempt && !busy && !terminalFailure && !reply?.result && reply?.status !== 'clarification';
  const examples = [...new Set(access.examples)];
  const latestResult = React.useMemo(() => ready ? reply?.result : history.findLast(turn => turn.reply?.status === 'ready')?.reply?.result, [ready, reply, history]);
  const mode = expanded ? 'expanded' : 'compact';
  const historyShown = historyOpen && (expanded || compactHistoryOpen);
  const researchShown = researchOpen && expanded;
  function closeHistory() { setHistoryOpen(false); setCompactHistoryOpen(false); historyToggle.current?.focus({ preventScroll: true }); }
  function closeResearch() { setResearchOpen(false); researchToggle.current?.focus({ preventScroll: true }); }
  function toggleHistory() {
    setHistoryMounted(true); setHistoryOpen(!historyShown);
    if (!expanded) setCompactHistoryOpen(!historyShown);
    if (!window.matchMedia?.('(min-width: 1280px)').matches) setResearchOpen(false);
  }
  const expandWorkspace = React.useCallback(() => {
    enterWorkspace();
    if (window.matchMedia?.('(min-width: 1024px)').matches && !historyMounted) {
      setHistoryMounted(true); setHistoryOpen(true);
    }
  }, [enterWorkspace, historyMounted]);
  const currentHistory = (opened: HistoryOpened) => {
    scroll.followNext(); openHistory(opened);
    if (!window.matchMedia?.('(min-width: 1024px)').matches) closeHistory();
  };
  const startNew = () => { resetConversation(false); scroll.followNext(); input.current?.focus(); };
  return <div ref={workspaceAnchorRef} className={workspaceStyles.anchor}>
  <div ref={workspaceSurfaceRef} className={`${styles.conversation} ${workspaceStyles.surface}`} id="colliers-ai"
    data-mode={mode} data-floating={floating} data-transitioning={transitioning}
    role={floating ? 'dialog' : undefined} aria-modal={floating ? true : undefined}
    aria-label={floating ? 'Colliers AI 工作空间' : undefined} tabIndex={-1}>
    {access.enabled && <header className={workspaceStyles.toolbar}>
      <div className={workspaceStyles.identity} hidden={!expanded}><strong>Colliers AI</strong><span>研究工作空间</span></div>
      <div className={workspaceStyles.toolbarActions}>
        <Button variant="ghost" className={workspaceStyles.homeButton} hidden={!expanded || historyShown} aria-label="返回主页" onClick={exitWorkspace}><ArrowLeft size={16} aria-hidden="true" /><span>主页</span></Button>
        {(expanded || attempt || history.length > 0) && <Button variant="ghost" hidden={expanded && historyShown} disabled={busy} aria-label="新对话" onClick={startNew}><Plus size={16} aria-hidden="true" /><span>新对话</span></Button>}
        <Button ref={historyToggle} variant="ghost" aria-label="历史记录" aria-expanded={historyShown} aria-controls="query-workspace-history" onClick={toggleHistory}><History size={16} aria-hidden="true" /><span>历史记录</span></Button>
        {latestResult && <Button ref={researchToggle} variant="ghost" aria-label="研究资料" aria-expanded={researchShown} aria-controls="query-workspace-research" onClick={() => {
          setResearchMounted(true); setResearchOpen(!researchShown);
          if (!expanded) expandWorkspace();
          if (!window.matchMedia?.('(min-width: 1280px)').matches) setHistoryOpen(false);
        }}><PanelRight size={16} aria-hidden="true" /><span>研究资料</span></Button>}
        <Button ref={workspaceToggleRef} variant="ghost" size="icon" aria-label={expanded ? '收起 Colliers AI 工作空间' : '展开 Colliers AI 工作空间'} aria-expanded={expanded} aria-controls="query-workspace-body"
          onPointerDown={event => { if (document.activeElement === input.current || composing.current) event.preventDefault(); }}
          onClick={() => expanded ? exitWorkspace() : expandWorkspace()}>
          {expanded ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
        </Button>
      </div>
    </header>}
    <div id="query-workspace-body" className={workspaceStyles.body}>
    <div id="query-workspace-history" className={workspaceStyles.history} hidden={!access.enabled || !historyShown} inert={!access.enabled || !historyShown}>
      {access.enabled && historyMounted && <HomeQueryHistory key={`${queryScopeKey(scope)}:${access.permissionRevision ?? ''}`} scope={scope} permissionRevision={access.permissionRevision} refreshKey={historyRefresh}
        activeConversationId={conversationId} busy={busy} onOpen={currentHistory} onClose={closeHistory}
        onNew={expanded ? startNew : undefined} onHome={expanded ? exitWorkspace : undefined} />}
    </div>
    <div className={workspaceStyles.main}>
    <div ref={workspaceScrollRef} className={workspaceStyles.scroller} role="region" aria-label="对话记录" tabIndex={0}
      onScroll={scroll.onScroll}>
    <div className={workspaceStyles.reading}>
    {access.enabled && !attempt && !history.length && <QueryWelcome displayName={displayName} />}
    {access.enabled && <div className={styles.transcript}>
      {history.map(turn => <PreviousTurn key={turn.attempt.idempotencyKey} turn={turn} scope={scope} internalExport={access.internalExport === true} onEdit={edit}
        presentation={mode} onExpand={expandWorkspace}
        canFollowUp={!busy && (turn.reply?.conversation ?? turn.attempt.conversation)?.id === conversationId} onFollowUp={action => followUp(action, turn)} />)}
      {attempt && <article key={attempt.idempotencyKey} className={styles.turn} aria-label="本次问答" data-query-turn={attempt.idempotencyKey}>
        <p className={styles.question}><span className="sr-only">你的问题：</span>{attempt.question || '已恢复的查询'}</p>
        <div className={styles.assistantResponse}>
        <AssistantHeading label={busy ? '正在处理' : assistantHelp ? '助手介绍' : needsConditions ? '需要补充条件' : ready ? '基于授权数据' : '查询状态'} />
      <div role="status" aria-live="polite" className={ready ? 'sr-only' : styles.status} data-state={busy ? 'working' : assistantHelp ? 'help' : needsConditions ? 'clarification' : 'status'}>
        {busy && <QueryWorkingIndicator />}{message}
      </div>
      {activeTurn && activeContext && needsConditions && <QueryActions label="请选择查询口径" actions={reply?.options} disabled={busy} onSelect={action => followUp(action, activeTurn)} />}
      {ready && reply?.result && <div hidden={collapsed}><HomeQueryResult key={reply.result.resultId} result={reply.result} delivery={reply} requestId={reply.requestId} scope={scope} internalExport={access.internalExport === true} presentation={mode} onExpand={expandWorkspace} visible={!collapsed} /></div>}
      {ready && reply?.historySaved !== undefined && <p className={styles.saveStatus}>{reply.historySaved ? '本次分析已自动保存至历史记录。' : '本次结果已留存，历史列表暂不可用。'}</p>}
      {activeTurn && activeContext && ready && !collapsed && <QueryActions label="继续分析" actions={suggestions(reply)} disabled={busy} onSelect={action => followUp(action, activeTurn)} />}
      <div className={`${styles.actions} ${styles.turnActions}`}>
        {retry && <Button variant="secondary" onClick={() => void run(attempt)}>重试本次请求</Button>}
        {savedId && !busy && !ready && <Button variant="ghost" onClick={() => void run({ idempotencyKey: attempt?.idempotencyKey ?? crypto.randomUUID(), question: attempt?.question ?? '', requestId: savedId, conversation: attempt?.conversation }, true)}>检查状态并恢复结果</Button>}
        {attempt && !busy && <Button variant="ghost" onClick={() => edit(attempt.question)}>编辑问题</Button>}
        {ready && attempt && <><Button variant="ghost" onClick={reexecute} disabled={!attempt.question || !attempt.requestId || busy}>重新查询</Button>
          <Button variant="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开本次结果' : '收起本次结果'}</Button></>}
      </div>
        </div>
      </article>}
      {!attempt && message && <p role="status" aria-live="polite" className={styles.status}>{message}</p>}
      {!attempt && savedId && !busy && <Button variant="ghost" onClick={() => void run({ idempotencyKey: crypto.randomUUID(), question: '', requestId: savedId }, true)}>检查状态并恢复结果</Button>}
    </div>}
    {access.enabled && !attempt && !history.length && examples.length > 0 && <section className={styles.starters} aria-label="示例问题">
      <p>今天想了解什么？</p>
      <div className={styles.suggestions}>{examples.slice(0, 4).map(question => <ExampleQuestion key={question} variant="secondary" question={question} onSelect={edit} />)}</div>
    </section>}
    {access.enabled && <details className={styles.capabilities}><summary>我能做什么</summary>
      <p>在你当前获权的范围内查找楼宇资料，分析净有效租金、空置率和季度变化，并查看数据来源。</p>
      <p>未收录、未获授权或尚未开放的能力会明确说明。我不会修改业务数据，也不会把缺失信息当作零。</p>
    </details>}
    {access.enabled && <details className={styles.examples} onToggle={event => setExamplesOpen(event.currentTarget.open)}><summary>探索更多与查询范围</summary>
      <div>{examplesOpen && examples.slice(4).map(question => <ExampleQuestion key={question} variant="ghost" question={question} onSelect={edit} />)}</div>
      <p>楼宇目录按当前获权范围查询；季度指标采用当前跟踪样本。示例年份仅说明格式，不代表该期一定有数据。</p>
      <p>当前会话保留全部问答，较长的此前回答按需展开。历史记录单独核对本人访问资格后打开原始快照；重新查询是另一项操作。选择“新对话”清除上文条件，身份变化时清除当前工作区。</p>
    </details>}
    </div>
    </div>
    <div className={workspaceStyles.inputDock}>
    {scroll.unseen && <div className={workspaceStyles.jump}><Button variant="secondary" onClick={scroll.toLatest}><ArrowDown size={14} aria-hidden="true" />回到最新消息</Button></div>}
    <div className={`${styles.composer} ${access.enabled ? styles.enabled : ''}`}>
      {buildingSelection && <div className={styles.selectionContext}><span>来自地图 · 已选择 {buildingSelection.ids.length} 栋楼宇</span><Button variant="ghost" onClick={() => setBuildingSelection(null)}>移除项目范围</Button></div>}
      <textarea ref={input} id="home-query" aria-label="向 Colliers AI 提问" aria-describedby="home-query-status home-query-notice" disabled={!access.enabled}
        rows={2} maxLength={6000} value={draft} onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        placeholder={access.enabled ? (attempt ? '继续追问，或提出一个新问题…' : '想了解哪栋楼，或哪一个市场？') : '对话查询尚未开放'}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          event.preventDefault();
          submitDraft();
        }} />
      <div className={styles.composerFooter}>
        <p id="home-query-status">{access.enabled ? 'Enter 发送 · Shift+Enter 换行' : message || (accessError ? '暂时无法核对查询资格，请稍后重进主页。原业务入口仍可使用。' : '目前请使用下方业务入口。')}</p>
        {busy ? <Button className={styles.sendButton} size="icon" variant="secondary" aria-label="停止等待" onClick={stopWaiting}><Square size={16} aria-hidden="true" /></Button>
          : <Button className={styles.sendButton} size="icon" aria-label="发送问题" disabled={!access.enabled || !draft.trim()} onClick={submitDraft}><ArrowUp size={18} strokeWidth={1.5} aria-hidden="true" /></Button>}
      </div>
    </div>
    <p id="home-query-notice" className={access.enabled ? styles.privacy : 'sr-only'}>{access.enabled ? '正式提交的提问及回答会留存，供获权审计人员查看。请勿输入密码或密钥。' : '对话查询尚未开放。'}</p>
    </div>
    </div>
    <div id="query-workspace-research" className={workspaceStyles.research} hidden={!access.enabled || !researchShown || !latestResult} inert={!access.enabled || !researchShown || !latestResult}>
      {access.enabled && researchMounted && latestResult && <HomeQueryResearchPanel result={latestResult} onClose={closeResearch} />}
    </div>
    </div>
  </div>
  </div>;
}
function PreviousTurn({ turn, scope, internalExport, onEdit, canFollowUp, onFollowUp, presentation, onExpand }: { turn: Turn; scope: QueryClientScope; internalExport: boolean; onEdit: (question: string) => void; canFollowUp: boolean; onFollowUp: (action: QueryAction) => void; presentation: 'compact' | 'expanded'; onExpand: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const result = turn.reply?.status === 'ready' ? turn.reply.result : undefined;
  const help = turn.reply?.reason === 'assistant_help';
  const actions = turn.reply?.status === 'clarification' ? turn.reply.options : suggestions(turn.reply);
  const controls = <>
    {turn.reply?.requestId && !help && <QueryActions label={turn.reply.status === 'clarification' ? '请选择查询口径' : '基于这条回答继续分析'}
      actions={actions} disabled={!canFollowUp} onSelect={onFollowUp} />}
    <Button variant="ghost" onClick={() => onEdit(turn.attempt.question)}>编辑这个问题</Button>
  </>;
  return <article className={styles.previousTurn} aria-label="此前问答" data-query-turn={turn.attempt.idempotencyKey}>
    <p className={styles.question}><span className="sr-only">你的问题：</span>{turn.attempt.question || '已恢复的查询'}</p>
    <div className={styles.assistantResponse}>
      <AssistantHeading label={result ? '基于授权数据' : help ? '助手介绍' : turn.reply?.status === 'clarification' ? '需要补充条件' : '查询状态'} />
      {result ? <>
        <p className={styles.previousSummary}>{resultSummary(result)[0]}</p>
        <details onToggle={event => { setOpen(event.currentTarget.open); if (event.currentTarget.open) setMounted(true); }}><summary>Colliers AI · 查看此前回答</summary>
          {mounted && <HomeQueryResult result={result} delivery={turn.reply ?? undefined} requestId={turn.reply?.requestId} scope={scope} internalExport={internalExport} presentation={presentation} onExpand={onExpand} visible={open} />}
          {open && controls}
        </details>
      </> : <><p className={styles.answerText}>{turn.message}</p>{controls}</>}
    </div>
  </article>;
}
function suggestions(reply: QueryReply | null): QueryAction[] {
  const parsed = queryActionSchema.array().max(6).safeParse(reply?.result?.parameters.suggestions);
  return parsed.success ? parsed.data : [];
}
function ExampleQuestion({ question, variant, onSelect }: { question: string; variant: 'ghost' | 'secondary'; onSelect: (question: string) => void }) {
  return <Button variant={variant} onClick={() => onSelect(question)}><span>{question}</span><ArrowUpRight size={15} aria-hidden="true" /></Button>;
}
function QueryActions({ actions, label, disabled, onSelect }: { actions?: QueryAction[]; label: string; disabled: boolean; onSelect: (action: QueryAction) => void }) {
  if (!actions?.length) return null;
  return <section className={styles.followUps} aria-label={label}><p>{label}</p><div className={styles.actions}>
    {actions.map(action => <Button key={action.id} variant="secondary" disabled={disabled} onClick={() => onSelect(action)}>{action.label}</Button>)}
  </div></section>;
}
