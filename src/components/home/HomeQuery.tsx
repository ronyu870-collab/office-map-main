'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ArrowUpRight, ArrowDown, ChevronDown, ChevronRight, CircleHelp, History, Maximize2, Minimize2, PanelRight, Pencil, Plus, X } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { IconButton } from '@/src/components/ui/IconButton';
import { trustedQueryClient, queryScopeKey, type QueryAccess, type QueryClientScope, type QueryReply } from '@/src/services/trustedQueryClient';
import { queryActionSchema, type QueryAction, type QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';
import { HomeQueryDetailProvider, HomeQueryDetailPanel, useQueryDetail } from './HomeQueryDetailPanel';
import { HomeQueryComposer, type QueryComposerHandle } from './HomeQueryComposer';
import { HomeQueryResponse } from './HomeQueryResponse';
import { resultSummary, type QueryResultView } from '@/src/lib/intelligence/query/presentation';
import { QueryWelcome, AssistantHeading, QueryWorkingIndicator, queryStarters } from './HomeQueryExperience';
import { QueryClientError, queryFailureMessage, queryServiceMessage } from '@/src/services/queryClientErrors';
import { readMapQueryContext, type BuildingSelection } from '@/src/lib/intelligence/query/buildingNavigation';
import type { HistoryOpened } from '@/src/lib/intelligence/query/historyProtocol';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import { useQueryWorkspace, useQueryScroll } from './useQueryWorkspace';
import { panelControls, useQueryPanelLayout } from './useQueryPanelLayout';
import { HomeQueryHelp } from './HomeQueryHelp';
import styles from './HomeQuery.module.css';
import workspaceStyles from './HomeQueryWorkspace.module.css';

const HomeQueryHistory = dynamic(() => import('./HomeQueryHistory').then(module => module.HomeQueryHistory), {
  loading: () => <p role="status">正在打开历史记录…</p>,
});
const HomeQueryResearchPanel = dynamic(() => import('./HomeQueryResearchPanel').then(module => module.HomeQueryResearchPanel), {
  loading: () => <p role="status">正在打开研究资料…</p>,
});
// First mounting a heavy answer module must not suspend send/stop feedback in
// the shared workspace. An explicit loading component adds a local boundary.
const HomeQueryMarkdown = dynamic(() => import('./HomeQueryMarkdown').then(module => module.HomeQueryMarkdown), { loading: () => null });
const HomeQueryAssistantActions = dynamic(() => import('./HomeQueryAssistantActions').then(module => module.HomeQueryAssistantActions), { loading: () => null });
type Attempt = { idempotencyKey: string; question: string; requestId?: string; conversation?: QueryConversation; buildingSelection?: BuildingSelection; replayRequestId?: string };
type Turn = { attempt: Attempt; reply: QueryReply | null; message: string };
const CLOSED: QueryAccess = { enabled: false, examples: [] };

/** A different verified identity must never inherit even in-memory questions. */
export function HomeQuery({ scope, displayName }: { scope: QueryClientScope; displayName?: string }) {
  return <HomeQueryDetailProvider key={queryScopeKey(scope)}><HomeQuerySession scope={scope} displayName={displayName} /></HomeQueryDetailProvider>;
}
function HomeQuerySession({ scope, displayName }: { scope: QueryClientScope; displayName?: string }) {
  const detail = useQueryDetail();
  const [access, setAccess] = React.useState<QueryAccess>(CLOSED);
  const [accessError, setAccessError] = React.useState(false);
  const composerHandle = React.useRef<QueryComposerHandle>(null);
  const setDraft = React.useCallback((value: string) => composerHandle.current?.setValue(value), []);
  const [reply, setReply] = React.useState<QueryReply | null>(null);
  const [message, setMessage] = React.useState('');
  const [streamDraft, setStreamDraft] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [terminalFailure, setTerminalFailure] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [history, setHistory] = React.useState<Turn[]>([]);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [conversationId, setConversationId] = React.useState(() => crypto.randomUUID());
  const [parentRequest, setParentRequest] = React.useState<string | undefined>(undefined);
  const [resumedContext, setResumedContext] = React.useState<QueryConversation | null>(null);
  const [resumedAgent, setResumedAgent] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [compactHistoryOpen, setCompactHistoryOpen] = React.useState(false);
  const [historyMounted, setHistoryMounted] = React.useState(false);
  const [researchOpen, setResearchOpen] = React.useState(false);
  const [researchMounted, setResearchMounted] = React.useState(false);
  const [historyRefresh, setHistoryRefresh] = React.useState(0);
  const [historyContextEpoch, setHistoryContextEpoch] = React.useState(0);
  const [historyCursor, setHistoryCursor] = React.useState<string>();
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyError, setHistoryError] = React.useState('');
  const earlierRequest = React.useRef<AbortController | null>(null);
  const [buildingSelection, setBuildingSelection] = React.useState<BuildingSelection | null>(null);
  const navigationConsumed = React.useRef<string | null>(null);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const composing = React.useRef(false), alive = React.useRef(true);
  const { anchor: workspaceAnchorRef, surface: workspaceSurfaceRef, scroller: workspaceScrollRef,
    composer: workspaceComposerRef, composerSlot: workspaceComposerSlotRef, toggle: workspaceToggleRef, mode, expanded, floating, transitioning,
    focus: focusWorkspace, expand: expandWorkspace, collapse: exitWorkspace,
    clearComposition: clearWorkspaceComposition, isComposing: isWorkspaceComposing } = useQueryWorkspace(composing);
  const preparePanelsForDrawer = React.useCallback(() => {
    const active = document.activeElement;
    // Resizing must not turn a panel into a modal over an active editor/IME.
    if (workspaceComposerRef.current?.contains(active)) {
      setHistoryOpen(false); setCompactHistoryOpen(false); setResearchOpen(false);
      return;
    }
    // Decide from the original focus before the drawer's layout effect moves
    // it. Otherwise a transient history modal would steal research's focus.
    if (historyOpen && researchOpen) {
      const historyHasFocus = workspaceSurfaceRef.current?.querySelector('#query-workspace-history')?.contains(active);
      if (historyHasFocus) setResearchOpen(false);
      else { setHistoryOpen(false); setCompactHistoryOpen(false); }
    }
  }, [historyOpen, researchOpen, workspaceComposerRef, workspaceSurfaceRef]);
  const panelLayout = useQueryPanelLayout(workspaceSurfaceRef, mode, preparePanelsForDrawer);
  const detailId = detail?.active?.id;
  const onDetailOpen = detail?.onOpen;
  React.useEffect(() => onDetailOpen?.(() => {
    setHistoryOpen(false); setCompactHistoryOpen(false); setResearchOpen(false); setHelpOpen(false);
    if (!expanded) focusWorkspace();
  }), [onDetailOpen, expanded, focusWorkspace]);
  const scroll = useQueryScroll(workspaceScrollRef,
    `${attempt?.idempotencyKey ?? ''}:${busy}:${message}:${streamDraft.length}:${reply?.status ?? ''}:${reply?.result?.resultId ?? ''}`,
    transitioning);
  const revealNextAnswer = scroll.revealNextAnswer;
  const historyToggle = React.useRef<HTMLButtonElement>(null);
  const researchToggle = React.useRef<HTMLButtonElement>(null);
  const helpToggle = React.useRef<HTMLButtonElement>(null);
  const historyPanel = React.useRef<HTMLDivElement>(null);
  const researchPanel = React.useRef<HTMLDivElement>(null);
  const helpPanel = React.useRef<HTMLDivElement>(null);
  const panelReturnFocus = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!expanded || !historyOpen || !researchOpen || panelLayout === 'both') return;
    const fitPanels = () => {
      // Preserve the focused editor (including an active IME). Otherwise keep
      // the explicitly opened research panel and its current reading context.
      const historyHasFocus = workspaceSurfaceRef.current?.querySelector('#query-workspace-history')?.contains(document.activeElement);
      if (historyHasFocus) setResearchOpen(false);
      else { setHistoryOpen(false); setCompactHistoryOpen(false); }
    };
    fitPanels();
  }, [expanded, historyOpen, researchOpen, panelLayout, workspaceSurfaceRef]);
  const current = React.useRef<AbortController | null>(null);
  const generation = React.useRef(0), revision = React.useRef<string | undefined>(undefined);
  useQueryPresentationReceipt(scope, reply, access.enabled && reply?.status === 'clarification' ? { surface: 'clarification' } : null);
  const storageKey = `trusted-query:last:${queryScopeKey(scope)}`;
  const clearSaved = React.useCallback(() => { setSavedId(null); try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }, [storageKey]);
  const resetConversation = React.useCallback((clearDraft = true) => {
    generation.current++; current.current?.abort(); current.current = null;
    earlierRequest.current?.abort(); earlierRequest.current = null;
    setHistoryContextEpoch(value => value + 1);
    setHistoryCursor(undefined); setHistoryLoading(false); setHistoryError(''); setHelpOpen(false);
    setParentRequest(undefined); setConversationId(crypto.randomUUID());
    setResumedContext(null); setResumedAgent(false); setBuildingSelection(null); setResearchOpen(false);
    setBusy(false); setTerminalFailure(false); setReply(null); setAttempt(null); setHistory([]); setCollapsed(false); setMessage(''); setStreamDraft('');
    if (clearDraft) {
      setDraft(''); composing.current = false; clearWorkspaceComposition(); exitWorkspace();
      setHistoryOpen(false); setCompactHistoryOpen(false); setHistoryMounted(false); setResearchMounted(false);
    }
    clearSaved();
  }, [clearSaved, exitWorkspace, clearWorkspaceComposition, setDraft]);

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
    return () => { alive.current = false; previous?.abort(); current.current?.abort(); current.current = null; earlierRequest.current?.abort(); window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [scope, storageKey, resetConversation]);


  const run = React.useCallback(async (next: Attempt, recovering = false) => {
    if (current.current || !access.enabled || composing.current) return;
    earlierRequest.current?.abort(); earlierRequest.current = null; setHistoryLoading(false);
    const controller = new AbortController(); current.current = controller;
    const ticket = ++generation.current;
    if (!recovering && next.idempotencyKey !== attempt?.idempotencyKey) {
      if (attempt) setHistory(items => [...items, { attempt, reply, message }]);
      // An interrupted new query must not restore the previous question's ID.
      clearSaved();
    }
    setBusy(true); setTerminalFailure(false); setCollapsed(false); setStreamDraft(''); setMessage(recovering ? '正在核对权限并恢复结果…' : '正在处理你的问题…'); setReply(null); setAttempt(next);
    setBuildingSelection(null);
    let observedRequestId = next.requestId;
    try {
      const useAgent = access.agentEnabled === true && !!next.conversation && !next.buildingSelection && !next.replayRequestId
        && (!next.conversation.resumeToken || resumedAgent);
      const payload = { idempotencyKey: next.idempotencyKey, question: next.question, ...(next.conversation ? { conversation: next.conversation } : {}), ...(next.buildingSelection ? { buildingSelection: next.buildingSelection } : {}), ...(next.replayRequestId ? { replayRequestId: next.replayRequestId } : {}) };
      const result = recovering && next.requestId ? await trustedQueryClient.recover(scope, next.requestId, controller.signal)
        : useAgent && access.agentStreamEnabled === true
          ? await trustedQueryClient.submitAgentStream(scope, payload as typeof payload & { conversation: QueryConversation },
            controller.signal, event => {
              if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
              const labels: Record<string, string> = {
                query_verified_real_estate: '核对房地产数据',
                search_buildings: '检索楼宇资料',
                get_building_profile: '核对楼宇信息',
                query_quarterly_metrics: '查询季度指标',
                compare_market_segments: '比较子市场',
                analyze_market_trends: '分析季度趋势',
                plan_research_task: '建立研究计划',
                advance_research_task: '执行研究步骤',
                review_research_task: '核对范围、来源与统计口径',
                generate_research_deliverable: '生成内部研究文件',
              };
              if (event.type === 'run_started') {
                // The terminal frame may never arrive. Keep only this opaque,
                // identity-scoped reference so recovery reads the original run
                // rather than issuing a fresh model request after interruption.
                observedRequestId = event.requestId;
                setAttempt({ ...next, requestId: event.requestId }); setSavedId(event.requestId);
                try { sessionStorage.setItem(storageKey, event.requestId); } catch { /* Mounted-session recovery remains available. */ }
                setMessage('正在研究你的问题…');
              }
              else if (event.type === 'tool_started') {
                setStreamDraft(''); setMessage('正在' + (labels[event.name] ?? '执行已授权数据查询') + '…');
              } else if (event.type === 'tool_completed') setMessage(event.status === 'ready'
                ? '数据步骤已完成，正在整理回答…' : '部分数据步骤未完成，正在整理说明…');
              else if (event.type === 'message_delta') {
                setStreamDraft(current => (current + event.delta).slice(0, 12000));
                setMessage('正在生成回答…');
              }
            })
          : useAgent ? await trustedQueryClient.submitAgent(scope, payload, controller.signal)
            : await trustedQueryClient.submit(scope, payload, controller.signal);
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      const updated = { ...next, requestId: result.requestId ?? observedRequestId }; setAttempt(updated);
      // Capacity rejection and a confirmed failed recovery are terminal for
      // this request key. A smaller edited question gets its own new key.
      const historyExpired = result.status === 'failed' && result.reason === 'history_reopen';
      const terminal = result.status === 'failed' && (result.reason === 'scope_limit' || historyExpired || recovering);
      setTerminalFailure(terminal);
      if (historyExpired) { setResumedContext(null); setParentRequest(undefined); setConversationId(crypto.randomUUID()); }
      if (terminal || result.status === 'assistant') clearSaved();
      else if (updated.requestId) {
        setSavedId(updated.requestId); try { sessionStorage.setItem(storageKey, updated.requestId); } catch { /* Recovery also works in this mounted session. */ }
      }
      if (result.status === 'denied') {
        setAccess(CLOSED); resetConversation();
        setMessage(result.error ?? '当前查询资格已不可用，请重新核对权限。');
        return;
      }
      if (!recovering && result.status === 'ready' && result.result) revealNextAnswer();
      setStreamDraft(''); setReply(result);
      setHistoryRefresh(value => value + 1);
      // Only completed, attributed turns become parents. A restored old request
      // without this page's conversation cannot silently seed a new dialogue.
      const responseConversation = result.conversation ?? next.conversation;
      if ((result.status === 'ready' || result.status === 'assistant' || result.status === 'clarification') && result.requestId
        && responseConversation && responseConversation.id === next.conversation?.id) { setConversationId(responseConversation.id); setParentRequest(result.requestId); setResumedContext(null); }
      if (result.status === 'ready' && result.result) setMessage('研究结果已生成。');
      else if (result.status === 'assistant') setMessage('');
      else if (historyExpired) setMessage('此历史上下文已过期，请重新打开历史记录后继续分析。也可以开始一个新问题。');
      else if (terminal) setMessage(result.reason === 'scope_limit'
        ? result.error ?? '本次查询范围超过交互容量，请减少子市场、季度或指标后重新提问。'
        : '本次请求未生成可恢复的结果，请修改问题后重新提交。');
      else if (result.status === 'clarification') { setMessage(result.reason === 'assistant_help' ? '' : result.message ?? '请补充完整查询条件。'); clearSaved(); }
      else if (result.status === 'running' || result.status === 'received') setMessage('请求已接收，服务端仍在处理。可检查状态并恢复原结果；不会重新查数。');
      else if (['already_received', 'succeeded', 'changed'].includes(result.status)) setMessage('请求已接收，可检查状态并恢复原结果；不会重新查数。');
      else if (result.status === 'unavailable') setMessage(queryServiceMessage(result.error));
      else { setMessage(result.error ?? '本次请求没有可恢复的结果，请检查权限或修改条件后重新查询。'); if (result.status === 'denied') clearSaved(); }
    } catch (error) {
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      if (error instanceof QueryClientError && error.kind === 'identity') { setAccess(CLOSED); resetConversation(); }
      setStreamDraft(''); setMessage(queryFailureMessage(error));
    } finally {
      if (current.current === controller) current.current = null;
      if (alive.current && ticket === generation.current) setBusy(false);
    }
  }, [access.enabled, access.agentEnabled, access.agentStreamEnabled, resumedAgent, attempt, reply, message, clearSaved, resetConversation, scope, storageKey, revealNextAnswer]);
  function stopWaiting() {
    generation.current++; current.current?.abort(); current.current = null; setBusy(false); setStreamDraft('');
    setMessage('已停止等待，回答可能仍在生成。可以检查状态并恢复结果。');
  }
  const edit = React.useCallback((question: string) => {
    setDraft(question);
    if (!expanded) focusWorkspace();
    input.current?.focus({ preventScroll: true });
  }, [expanded, focusWorkspace, setDraft]);
  function newAttempt(question: string, parent = parentRequest): Attempt {
    return { idempotencyKey: crypto.randomUUID(), question,
      ...(buildingSelection ? { buildingSelection } : {}),
      conversation: { id: conversationId, ...(parent ? { parentRequestId: parent } : {}),
        ...(resumedContext?.parentRequestId === parent && resumedContext?.resumeToken ? { resumeToken: resumedContext.resumeToken } : {}) } };
  }
  function submitDraft() {
    const draft = composerHandle.current?.value() ?? '';
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
    setConversationId(id); setParentRequest(undefined); setResumedContext(null); setHistoryCursor(undefined);
    // The server reauthorizes the archived executed plan. In particular, a
    // relative question such as "去年同期" must not shift its dates a second time.
    void run({ idempotencyKey: crypto.randomUUID(), question: attempt.question,
      conversation: { id }, replayRequestId: attempt.requestId });
  }
  const openHistory = React.useCallback((opened: HistoryOpened) => {
    generation.current++; current.current?.abort(); current.current = null;
    earlierRequest.current?.abort(); earlierRequest.current = null;
    const selected = opened.selected;
    setBusy(false); setTerminalFailure(false); setCollapsed(false); setHistoryLoading(false); setHistoryError('');
    setHistory((opened.timeline ?? []).filter(turn => turn.requestId !== selected.requestId).map(turn => historyTurn(turn, opened.conversation)));
    setHistoryCursor(opened.timeline && opened.hasMore ? opened.nextCursor : undefined);
    setConversationId(opened.conversation.id); setParentRequest(opened.conversation.parentRequestId); setResumedContext(opened.conversation);
    setResumedAgent(selected.reply.isNativeAgent === true);
    setAttempt({ idempotencyKey: crypto.randomUUID(), question: selected.question, requestId: selected.requestId, conversation: opened.conversation });
    setReply(selected.reply); setMessage(['ready', 'assistant'].includes(selected.reply.status) || selected.reply.reason === 'assistant_help' ? '' : selected.reply.message ?? selected.reply.error ?? '已打开历史工作记录。');
    setBuildingSelection(null); setSavedId(selected.requestId);
    try { sessionStorage.setItem(storageKey, selected.requestId); } catch { /* Only an opaque request reference is stored. */ }
  }, [storageKey]);
  async function loadEarlier() {
    if (!historyCursor || historyLoading || busy) return;
    const controller = new AbortController(); earlierRequest.current?.abort(); earlierRequest.current = controller;
    const ticket = generation.current;
    setHistoryLoading(true); setHistoryError('');
    try {
      const { trustedQueryHistoryClient } = await import('@/src/services/trustedQueryHistoryClient');
      const opened = await trustedQueryHistoryClient.open(scope, { conversationId, cursor: historyCursor, includeTimeline: true }, controller.signal);
      if (controller.signal.aborted || ticket !== generation.current || !alive.current) return;
      scroll.preserveBeforePrepend();
      // Paging never replaces the selected turn, resume token or unsent input.
      setHistory(previous => {
        const existing = new Set([...previous.map(turn => turn.attempt.requestId), attempt?.requestId]);
        const earlier = (opened.timeline ?? []).filter(turn => !existing.has(turn.requestId));
        return [...earlier.map(turn => historyTurn(turn, opened.conversation)), ...previous];
      });
      setHistoryCursor(opened.hasMore ? opened.nextCursor : undefined);
    } catch (error) {
      if (!controller.signal.aborted && ticket === generation.current && alive.current) setHistoryError(error instanceof Error ? error.message : '更早问答暂时无法读取，请重试。');
    } finally {
      if (earlierRequest.current === controller) { earlierRequest.current = null; if (alive.current) setHistoryLoading(false); }
    }
  }
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
    void import('@/src/services/trustedQueryHistoryClient').then(module => module.trustedQueryHistoryClient.open(scope, { requestId, includeTimeline: true }, controller.signal))
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
  }, [access.enabled, run, openHistory, scope, setDraft]);
  const activeTurn: Turn | null = attempt ? { attempt, reply, message } : null;
  const activeContext = !!attempt && !!reply?.requestId && (reply.conversation ?? attempt.conversation)?.id === conversationId;
  const ready = reply?.status === 'ready' && !!reply.result;
  const assistantHelp = reply?.status === 'clarification' && reply.reason === 'assistant_help';
  const needsConditions = reply?.status === 'clarification' && !assistantHelp;
  const recoveryAvailable = !!savedId && !busy && !ready && reply?.status !== 'assistant';
  const retry = attempt && !busy && !terminalFailure && !reply?.result && !['clarification', 'assistant'].includes(reply?.status ?? '');
  const examples = [...new Set(access.examples)];
  const starters = queryStarters(examples);
  const emptyConversation = !attempt && !history.length;
  const latestResult = React.useMemo(() => ready ? reply?.result : history.findLast(turn => turn.reply?.status === 'ready')?.reply?.result, [ready, reply, history]);
  const presentation = expanded ? 'expanded' : 'compact';
  const historyShown = !detailId && historyOpen && (expanded || compactHistoryOpen);
  const researchShown = !detailId && researchOpen && expanded;
  const modalPanel = helpOpen ? 'help' : expanded && panelLayout === 'drawer' ? (historyShown ? 'history' : researchShown ? 'research' : null) : null;
  React.useLayoutEffect(() => {
    if (!modalPanel) {
      const focusStaysInPanel = (historyShown && historyPanel.current?.contains(document.activeElement))
        || (researchShown && researchPanel.current?.contains(document.activeElement));
      if (!focusStaysInPanel) panelReturnFocus.current?.focus({ preventScroll: true });
      panelReturnFocus.current = null;
      return;
    }
    const panel = modalPanel === 'history' ? historyPanel.current : modalPanel === 'research' ? researchPanel.current : helpPanel.current;
    panelReturnFocus.current = (modalPanel === 'history' ? historyToggle : modalPanel === 'research' ? researchToggle : helpToggle).current;
    if (panel && !panel.contains(document.activeElement)) (panelControls(panel)[0] ?? panel).focus({ preventScroll: true });
  }, [modalPanel, historyShown, researchShown]);
  function closeHistory() { setHistoryOpen(false); setCompactHistoryOpen(false); historyToggle.current?.focus({ preventScroll: true }); }
  function closeResearch() { setResearchOpen(false); researchToggle.current?.focus({ preventScroll: true }); }
  function toggleHistory() {
    detail?.close();
    if (composing.current) return;
    setHistoryMounted(true); setHistoryOpen(!historyShown);
    if (!expanded) { setCompactHistoryOpen(!historyShown); focusWorkspace(); }
    if (panelLayout !== 'both') setResearchOpen(false);
  }
  const currentHistory = (opened: HistoryOpened) => {
    scroll.followNext(); openHistory(opened);
    if (panelLayout === 'drawer') closeHistory();
  };
  const startNew = () => { detail?.close(); panelReturnFocus.current = input.current; resetConversation(false); setHistoryOpen(false); setCompactHistoryOpen(false); scroll.followNext(); input.current?.focus({ preventScroll: true }); };
  const closeHelp = () => { setHelpOpen(false); };
  const returnHome = () => { detail?.close(); if (!exitWorkspace()) return; setHelpOpen(false); setHistoryOpen(false); setCompactHistoryOpen(false); };
  function panelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229 || isWorkspaceComposing()) return;
    if (event.key === 'Escape' && (helpOpen || (panelLayout === 'drawer' && (historyShown || researchShown)))) {
      event.preventDefault(); event.stopPropagation();
      if (helpOpen) closeHelp(); else if (historyShown) closeHistory(); else closeResearch();
      return;
    }
    if (event.key !== 'Tab' || !modalPanel) return;
    const panel = modalPanel === 'history' ? historyPanel.current : modalPanel === 'research' ? researchPanel.current : helpPanel.current;
    if (!panel) return;
    const controls = panelControls(panel), index = controls.indexOf(document.activeElement as HTMLElement);
    event.preventDefault(); event.stopPropagation();
    const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    (controls[next] ?? panel).focus();
  }
  function viewResearchSources() {
    if (!latestResult) return;
    const ticket = generation.current, resultId = latestResult.resultId;
    if (panelLayout === 'drawer') setResearchOpen(false);
    setCollapsed(false);
    const disclosure = workspaceSurfaceRef.current?.querySelector<HTMLButtonElement>(`[data-query-result-disclosure="${resultId}"]`);
    if (disclosure?.getAttribute('aria-expanded') === 'false') disclosure.click();
    window.requestAnimationFrame(() => {
      if (!alive.current || ticket !== generation.current) return;
      const sourceAction = workspaceSurfaceRef.current?.querySelector<HTMLButtonElement>(`[data-result-id="${resultId}"] [data-query-all-sources]`);
      const disclosure = sourceAction?.closest('details'); if (disclosure) disclosure.open = true;
      sourceAction?.click();
    });
  }
  const preserveEditorFocus = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = document.activeElement;
    if (composing.current || ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement)
      && workspaceSurfaceRef.current?.contains(active))) event.preventDefault();
  };
  return <div ref={workspaceAnchorRef} className={workspaceStyles.anchor}>
  <div className={workspaceStyles.backdrop} data-open={expanded} hidden={!floating} aria-hidden="true" />
  <div ref={workspaceSurfaceRef} className={`${styles.conversation} ${workspaceStyles.surface}`} id="colliers-ai"
    data-mode={mode} data-floating={floating} data-transitioning={transitioning} data-empty={emptyConversation}
    data-panels={panelLayout} onKeyDown={panelKeyDown}
    role={floating ? 'dialog' : undefined} aria-modal={floating ? true : undefined}
    aria-label={floating ? 'Colliers AI 工作空间' : undefined} tabIndex={-1}>
    <header className={workspaceStyles.toolbar} inert={!!modalPanel || (!!detailId && panelLayout === 'drawer')}>
      <div className={workspaceStyles.identity}><strong>Colliers <span>AI</span></strong>{expanded && attempt?.question && <span className={workspaceStyles.conversationTitle} title={attempt.question}>{attempt.question}</span>}</div>
      {access.enabled && <div className={workspaceStyles.toolbarActions}>
        {(expanded || attempt || history.length > 0) && <Button className={workspaceStyles.newConversation} variant="ghost" disabled={busy} aria-label="新对话" title="新对话" onClick={startNew}><Plus size={16} aria-hidden="true" /><span>新对话</span></Button>}
        <IconButton ref={historyToggle} variant="ghost" label="历史记录" aria-expanded={historyShown} aria-controls="query-workspace-history" onClick={toggleHistory}><History size={16} aria-hidden="true" /></IconButton>
        {latestResult && <IconButton ref={researchToggle} variant="ghost" label="研究资料" aria-expanded={researchShown} aria-controls="query-workspace-research" onClick={() => {
          detail?.close(); setResearchMounted(true); setResearchOpen(!researchShown);
          if (!expanded) focusWorkspace();
          if (panelLayout !== 'both') setHistoryOpen(false);
        }}><PanelRight size={16} aria-hidden="true" /></IconButton>}
        <IconButton ref={helpToggle} variant="ghost" label="能力与范围" aria-expanded={helpOpen} aria-controls="query-workspace-help" onClick={() => { if (composing.current) return; detail?.close(); setHelpOpen(true); if (!expanded) focusWorkspace(); }}><CircleHelp size={16} aria-hidden="true" /></IconButton>
        {expanded && <IconButton className={workspaceStyles.fullscreenToggle} variant="ghost" label={mode === 'expanded' ? '退出全屏 Colliers AI 工作空间' : '全屏 Colliers AI 工作空间'}
          aria-pressed={mode === 'expanded'} aria-controls="query-workspace-body" onPointerDown={preserveEditorFocus}
          onClick={() => mode === 'expanded' ? focusWorkspace() : expandWorkspace()}>
          {mode === 'expanded' ? <Minimize2 size={16} aria-hidden="true" /> : <Maximize2 size={16} aria-hidden="true" />}
        </IconButton>}
        <IconButton ref={workspaceToggleRef} variant="ghost" label={expanded ? '收起 Colliers AI 工作空间' : '展开 Colliers AI 工作空间'} title={expanded ? '返回主页' : '展开 Colliers AI 工作空间'} aria-expanded={expanded} aria-controls="query-workspace-body"
          onPointerDown={preserveEditorFocus}
          onClick={() => expanded ? returnHome() : expandWorkspace()}>
          {expanded ? <><X size={16} aria-hidden="true" /><span>回首页</span></> : <Maximize2 size={16} aria-hidden="true" />}
        </IconButton>
      </div>}
    </header>
    <div id="query-workspace-body" className={workspaceStyles.body}>
    {modalPanel && modalPanel !== 'help' && <button type="button" tabIndex={-1} className={workspaceStyles.panelBackdrop} aria-label="关闭侧栏" onClick={() => historyShown ? closeHistory() : closeResearch()} />}
    <div ref={historyPanel} id="query-workspace-history" className={workspaceStyles.history} hidden={!access.enabled || !historyShown} inert={!access.enabled || !historyShown || helpOpen}
      role={modalPanel === 'history' ? 'dialog' : undefined} aria-modal={modalPanel === 'history' ? true : undefined} aria-label={modalPanel === 'history' ? '历史记录侧栏' : undefined} tabIndex={-1}>
      {access.enabled && historyMounted && <HomeQueryHistory key={`${queryScopeKey(scope)}:${access.permissionRevision ?? ''}`} scope={scope} permissionRevision={access.permissionRevision} refreshKey={historyRefresh}
        contextEpoch={historyContextEpoch} activeConversationId={conversationId} activeRequestId={attempt?.requestId} busy={busy} onOpen={currentHistory} onClose={closeHistory} onNew={startNew} onHome={returnHome} />}
    </div>
    <div className={workspaceStyles.main} inert={!!modalPanel || (!!detailId && panelLayout === 'drawer')}>
    <div ref={workspaceScrollRef} className={workspaceStyles.scroller} role="region" aria-label="对话记录" tabIndex={0}
      onScroll={scroll.onScroll}>
    <div className={workspaceStyles.reading}>
    {access.enabled && !attempt && !history.length && <QueryWelcome displayName={displayName} />}
    {access.enabled && emptyConversation && expanded && <StarterQuestions starters={starters} onSelect={edit} />}
    {access.enabled && <div className={styles.transcript}>
      {historyCursor && <div className={styles.historyPaging}><Button variant="ghost" disabled={historyLoading || busy} onClick={() => void loadEarlier()}>{historyLoading ? '正在加载更早问答…' : '加载更早问答'}</Button></div>}
      {historyError && <p role="alert" className={styles.historyError}>{historyError}</p>}
      {history.map(turn => <PreviousTurn key={turn.attempt.idempotencyKey} turn={turn} scope={scope} internalExport={access.internalExport === true} onEdit={edit}
        presentation={presentation} onExpand={expandWorkspace}
        canFollowUp={!busy && (turn.reply?.conversation ?? turn.attempt.conversation)?.id === conversationId} onFollowUp={action => followUp(action, turn)} />)}
      {attempt && <article key={attempt.idempotencyKey} className={styles.turn} aria-label="本次问答" data-query-turn={attempt.idempotencyKey}>
        <div className={styles.questionRow}><p className={styles.question}><span className="sr-only">你的问题：</span>{attempt.question || '已恢复的查询'}{!busy && <button type="button" className={styles.editQuestion} onClick={() => edit(attempt.question)} aria-label="编辑问题" title="编辑问题"><Pencil size={14} aria-hidden="true" /></button>}</p></div>
        <div className={styles.assistantResponse}>
        <AssistantHeading label={needsConditions ? '需要补充条件' : terminalFailure ? '查询未完成' : undefined} />
      <div role="status" aria-live="polite" className={ready || reply?.status === 'assistant' || assistantHelp ? 'sr-only' : styles.status} data-state={busy ? 'working' : needsConditions ? 'clarification' : terminalFailure ? 'error' : 'status'}>
        {busy && <QueryWorkingIndicator />}{message}
      </div>
      {busy && streamDraft && <HomeQueryMarkdown text={streamDraft} streaming aria-label="正在生成的部分回答" />}
      {(reply?.status === 'assistant' || ready || assistantHelp) && <HomeQueryResponse question={attempt?.question} message={reply?.message} answerSelection={reply?.answerSelection} result={ready ? reply?.result : undefined} executionStatus={reply?.agent?.executionStatus} delivery={reply ?? undefined} requestId={reply?.requestId} scope={scope} internalExport={access.internalExport === true} presentation={presentation} onExpand={expandWorkspace} collapsed={collapsed} onReveal={() => setCollapsed(false)} responseActions={ready && attempt ? <>
        <Button variant="ghost" onClick={reexecute} disabled={!attempt.question || !attempt.requestId || busy}>重新查询</Button>
        {longResult(reply?.result) && <Button variant="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>收起本次结果</Button>}
      </> : undefined} />}
      {(reply?.status === 'assistant' || assistantHelp) && reply?.requestId && <HomeQueryAssistantActions scope={scope} requestId={reply.requestId} conversationId={reply.conversation?.id ?? conversationId} message={reply.message ?? ''} internalExport={access.internalExport === true} />}
      {activeTurn && activeContext && needsConditions && <QueryActions label="请选择查询口径" actions={reply?.options} disabled={busy} onSelect={action => followUp(action, activeTurn)} />}
      {ready && reply?.historySaved === false && <p role="status" className={styles.saveStatus}>本次结果已留存，历史列表暂不可用。</p>}
      {activeTurn && activeContext && ready && !collapsed && <QueryActions label="继续分析" actions={suggestions(reply)} disabled={busy} onSelect={action => followUp(action, activeTurn)} />}
      {(retry || recoveryAvailable) && <div className={`${styles.actions} ${styles.turnActions}`}>
        {retry && <Button variant="secondary" onClick={() => void run(attempt)}>重试本次请求</Button>}
        {recoveryAvailable && <Button variant="ghost" onClick={() => void run({ idempotencyKey: attempt?.idempotencyKey ?? crypto.randomUUID(), question: attempt?.question ?? '', requestId: savedId, conversation: attempt?.conversation }, true)}>检查状态并恢复结果</Button>}
      </div>}
        </div>
      </article>}
      {!attempt && message && <p role="status" aria-live="polite" className={styles.status}>{message}</p>}
      {!attempt && savedId && !busy && <Button variant="ghost" onClick={() => void run({ idempotencyKey: crypto.randomUUID(), question: '', requestId: savedId }, true)}>检查状态并恢复结果</Button>}
    </div>}
    </div>
    </div>
    <div className={workspaceStyles.inputDock}>
    {scroll.unseen && <div className={workspaceStyles.jump}><Button variant="secondary" onClick={scroll.toLatest}><ArrowDown size={14} aria-hidden="true" />回到最新消息</Button></div>}
    <div ref={workspaceComposerSlotRef} className={workspaceStyles.composerSlot}>
    <div ref={workspaceComposerRef} className={`${styles.composer} ${access.enabled ? styles.enabled : ''}`}>
      {buildingSelection && <div className={styles.selectionContext}><span>来自地图 · 已选择 {buildingSelection.ids.length} 栋楼宇</span><Button variant="ghost" onClick={() => setBuildingSelection(null)}>移除项目范围</Button></div>}
      <HomeQueryComposer editorRef={input} composingRef={composing} handle={composerHandle} enabled={access.enabled} busy={busy} followUp={!!attempt}
        onFocus={() => { if (access.enabled && mode === 'compact') focusWorkspace(); }} onSubmit={submitDraft} onStop={stopWaiting}
        status={message || (accessError ? '暂时无法核对查询资格，请稍后重进主页。原业务入口仍可使用。' : '目前请使用下方业务入口。')} />
    </div>
    </div>
    {access.enabled && emptyConversation && !expanded && <StarterQuestions starters={starters} onSelect={edit} />}
    </div>
    </div>
    <div ref={researchPanel} id="query-workspace-research" className={workspaceStyles.research} hidden={!access.enabled || !researchShown || !latestResult} inert={!access.enabled || !researchShown || !latestResult || helpOpen}
      role={modalPanel === 'research' ? 'dialog' : undefined} aria-modal={modalPanel === 'research' ? true : undefined} aria-label={modalPanel === 'research' ? '研究资料侧栏' : undefined} tabIndex={-1}>
      {access.enabled && researchMounted && latestResult && <HomeQueryResearchPanel result={latestResult} onClose={closeResearch} onViewSources={viewResearchSources} />}
    </div>
    <HomeQueryDetailPanel drawer={panelLayout === 'drawer'} />
    {helpOpen && <button type="button" tabIndex={-1} className={workspaceStyles.helpBackdrop} aria-label="关闭帮助" onClick={closeHelp} />}
    <div ref={helpPanel} id="query-workspace-help" className={workspaceStyles.help} hidden={!access.enabled || !helpOpen} inert={!access.enabled || !helpOpen}
      role="dialog" aria-modal="true" aria-labelledby="query-help-heading" tabIndex={-1}>
      <HomeQueryHelp examples={helpOpen ? examples.filter(question => !starters.some(item => item.question === question)) : []} onClose={closeHelp} onSelect={question => { panelReturnFocus.current = input.current; setHelpOpen(false); edit(question); }} />
    </div>
    </div>
  </div>
  </div>;
}
const PreviousTurn = React.memo(function PreviousTurn({ turn, scope, internalExport, onEdit, canFollowUp, onFollowUp, presentation, onExpand }: { turn: Turn; scope: QueryClientScope; internalExport: boolean; onEdit: (question: string) => void; canFollowUp: boolean; onFollowUp: (action: QueryAction) => void; presentation: 'compact' | 'expanded'; onExpand: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  const resultPanelId = React.useId();
  const result = turn.reply?.status === 'ready' ? turn.reply.result : undefined;
  const help = turn.reply?.reason === 'assistant_help';
  const text = turn.reply?.message ?? turn.message;
  const longText = text.length > 240;
  const actions = turn.reply?.status === 'clarification' ? turn.reply.options : suggestions(turn.reply);
  const controls = <>
    {turn.reply?.requestId && !help && <QueryActions label={turn.reply.status === 'clarification' ? '请选择查询口径' : '基于这条回答继续分析'}
      actions={actions} disabled={!canFollowUp} onSelect={onFollowUp} />}
  </>;
  return <article className={styles.previousTurn} aria-label="此前问答" data-query-turn={turn.attempt.idempotencyKey}>
    <div className={styles.questionRow}><p className={styles.question}><span className="sr-only">你的问题：</span>{turn.attempt.question || '已恢复的查询'}<button type="button" className={styles.editQuestion} onClick={() => onEdit(turn.attempt.question)} aria-label="编辑这个问题" title="编辑这个问题"><Pencil size={14} aria-hidden="true" /></button></p></div>
    <div className={styles.assistantResponse}>
      <AssistantHeading label={!help && turn.reply?.status === 'clarification' ? '需要补充条件' : undefined} />
      {result ? <>
        {!open && <HomeQueryMarkdown text={turn.reply?.answerSelection?.notice ?? resultSummary(result)[0]} navigation={false} />}
        <Button className={styles.resultDisclosure} variant="ghost" aria-expanded={open} aria-controls={resultPanelId} data-query-result-disclosure={result.resultId}
          onClick={() => { setOpen(value => !value); setMounted(true); }}>{open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}{open ? '收起数据与来源' : '展开数据与来源'}</Button>
        <div id={resultPanelId} hidden={!open}>
          {mounted && <HomeQueryResponse question={turn.attempt.question} message={turn.reply?.message} answerSelection={turn.reply?.answerSelection} result={result} executionStatus={turn.reply?.agent?.executionStatus} delivery={turn.reply ?? undefined} requestId={turn.reply?.requestId} scope={scope} internalExport={internalExport} presentation={presentation} onExpand={onExpand} collapsed={!open} />}
          {open && controls}
        </div>
      </> : <>
        {longText && <>
          {!open && <p className={styles.previousSummary}>已保存的文字回答</p>}
          <Button className={styles.resultDisclosure} variant="ghost" aria-expanded={open} aria-controls={resultPanelId}
            onClick={() => { setOpen(value => !value); setMounted(true); }}>{open ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}{open ? '收起完整回答' : '展开完整回答'}</Button>
        </>}
        <div id={resultPanelId} hidden={longText && !open}>
          {(!longText || mounted) && <HomeQueryMarkdown text={text} navigation />}
          {(turn.reply?.status === 'assistant' || help) && turn.reply?.requestId && turn.attempt.conversation && <HomeQueryAssistantActions scope={scope} requestId={turn.reply.requestId} conversationId={turn.attempt.conversation.id} message={turn.reply.message ?? ''} internalExport={internalExport} />}
          <div className={styles.turnActions}>{controls}</div>
        </div>
      </>}
    </div>
  </article>;
});
function historyTurn(snapshot: HistoryOpened['selected'], conversation: QueryConversation): Turn {
  return { attempt: { idempotencyKey: crypto.randomUUID(), requestId: snapshot.requestId, question: snapshot.question, conversation: snapshot.reply.conversation ?? conversation },
    reply: snapshot.reply, message: snapshot.reply.message ?? snapshot.reply.error ?? '' };
}
function longResult(result?: QueryResultView): boolean {
  return !!result && (result.table.rows.length > 5 || result.table.columns.length > 6 || result.parameters.researchTask != null);
}
function suggestions(reply: QueryReply | null): QueryAction[] {
  const parsed = queryActionSchema.array().max(6).safeParse(reply?.result?.parameters.suggestions);
  return parsed.success ? parsed.data.slice(0, 2) : [];
}
function StarterQuestions({ starters, onSelect }: { starters: { question: string; label: string }[]; onSelect: (question: string) => void }) {
  if (!starters.length) return null;
  return <section className={styles.starters} aria-label="示例问题">
    <div className={styles.suggestions}>{starters.map(({ question, label }) => <ExampleQuestion key={question} variant="ghost" question={question} label={label} onSelect={onSelect} />)}</div>
  </section>;
}
function ExampleQuestion({ question, label, variant, onSelect }: { question: string; label?: string; variant: 'ghost' | 'secondary'; onSelect: (question: string) => void }) {
  return <Button variant={variant} aria-label={label && label !== question ? `${label}：${question}` : question} title={label ? question : undefined} onClick={() => onSelect(question)}><span>{label ?? question}</span><ArrowUpRight size={14} aria-hidden="true" /></Button>;
}
function QueryActions({ actions, label, disabled, onSelect }: { actions?: QueryAction[]; label: string; disabled: boolean; onSelect: (action: QueryAction) => void }) {
  if (!actions?.length) return null;
  return <section className={styles.followUps} aria-label={label}><div className={styles.actions}>
    {actions.map(action => <Button key={action.id} variant="secondary" disabled={disabled} onClick={() => onSelect(action)}>{action.label}</Button>)}
  </div></section>;
}
