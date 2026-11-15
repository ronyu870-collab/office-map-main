'use client';

import * as React from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, queryScopeKey, type QueryAccess, type QueryClientScope, type QueryReply } from '@/src/services/trustedQueryClient';
import { queryActionSchema, type QueryAction, type QueryConversation } from '@/src/lib/intelligence/query/conversationProtocol';
import { HomeQueryResult } from './HomeQueryResult';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';

type Attempt = { idempotencyKey: string; question: string; requestId?: string; conversation?: QueryConversation };
type Turn = { attempt: Attempt; reply: QueryReply | null; message: string };
const CLOSED: QueryAccess = { enabled: false, examples: [] };

/** A different verified identity must never inherit even in-memory questions. */
export function HomeQuery({ scope }: { scope: QueryClientScope }) {
  return <HomeQuerySession key={queryScopeKey(scope)} scope={scope} />;
}
function HomeQuerySession({ scope }: { scope: QueryClientScope }) {
  const [access, setAccess] = React.useState<QueryAccess>(CLOSED);
  const [accessError, setAccessError] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [reply, setReply] = React.useState<QueryReply | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [examplesOpen, setExamplesOpen] = React.useState(false);
  const [history, setHistory] = React.useState<Turn[]>([]);
  const [savedId, setSavedId] = React.useState<string | null>(null);
  const [conversationId, setConversationId] = React.useState(() => crypto.randomUUID());
  const [parentRequest, setParentRequest] = React.useState<string | undefined>(undefined);
  const input = React.useRef<HTMLTextAreaElement>(null);
  const composing = React.useRef(false), alive = React.useRef(true);
  const current = React.useRef<AbortController | null>(null);
  const generation = React.useRef(0), revision = React.useRef<string | undefined>(undefined);
  useQueryPresentationReceipt(scope, reply, access.enabled && reply?.status === 'clarification' ? { surface: 'clarification' } : null);
  const storageKey = `trusted-query:last:${queryScopeKey(scope)}`;
  const clearSaved = React.useCallback(() => { setSavedId(null); try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }, [storageKey]);
  const resetConversation = React.useCallback((clearDraft = true) => {
    generation.current++; current.current?.abort(); current.current = null;
    setParentRequest(undefined); setConversationId(crypto.randomUUID());
    setBusy(false); setReply(null); setAttempt(null); setHistory([]); setCollapsed(false); setMessage('');
    if (clearDraft) setDraft('');
    clearSaved();
  }, [clearSaved]);

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

  async function run(next: Attempt, recovering = false) {
    if (current.current || !access.enabled || composing.current) return;
    const controller = new AbortController(); current.current = controller;
    const ticket = ++generation.current;
    if (!recovering && next.idempotencyKey !== attempt?.idempotencyKey) {
      if (attempt) setHistory(items => [...items, { attempt, reply, message }].slice(-9));
      // An interrupted new query must not restore the previous question's ID.
      clearSaved();
    }
    setBusy(true); setCollapsed(false); setMessage(recovering ? '正在核对权限并恢复结果…' : '正在查询授权数据…'); setReply(null); setAttempt(next);
    try {
      const result = recovering && next.requestId ? await trustedQueryClient.recover(scope, next.requestId, controller.signal)
        : await trustedQueryClient.submit(scope, { idempotencyKey: next.idempotencyKey, question: next.question, ...(next.conversation ? { conversation: next.conversation } : {}) }, controller.signal);
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      const updated = { ...next, requestId: result.requestId ?? next.requestId }; setAttempt(updated);
      if (updated.requestId) {
        setSavedId(updated.requestId); try { sessionStorage.setItem(storageKey, updated.requestId); } catch { /* Recovery also works in this mounted session. */ }
      }
      if (result.status === 'denied') {
        setAccess(CLOSED); resetConversation();
        setMessage(result.error ?? '当前查询资格已不可用，请重新核对权限。');
        return;
      }
      setReply(result);
      // Only completed, attributed turns become parents. A restored old request
      // without this page's conversation cannot silently seed a new dialogue.
      const responseConversation = result.conversation ?? next.conversation;
      if ((result.status === 'ready' || result.status === 'clarification') && result.requestId
        && responseConversation?.id === conversationId) setParentRequest(result.requestId);
      if (result.status === 'ready' && result.result) setMessage('查询完成。');
      else if (result.status === 'clarification') { setMessage(result.message ?? '请补充完整查询条件。'); clearSaved(); }
      else if (['already_received', 'received', 'running', 'succeeded', 'changed'].includes(result.status)) setMessage('请求已接收，可检查状态并恢复原结果；不会重新查数。');
      else { setMessage(result.error ?? '本次请求没有可恢复的结果，请检查权限或修改条件后重新查询。'); if (result.status === 'denied') clearSaved(); }
    } catch {
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      setMessage('未能取得查询响应。可用“重试本次请求”核对原请求，避免重复执行。');
    } finally {
      if (current.current === controller) current.current = null;
      if (alive.current && ticket === generation.current) setBusy(false);
    }
  }
  function stopWaiting() {
    generation.current++; current.current?.abort(); current.current = null; setBusy(false);
    setMessage('已停止等待，服务端可能仍在处理。可重试本次请求或恢复结果，不能据此认定服务端已取消。');
  }
  const edit = React.useCallback((question: string) => { setDraft(question); input.current?.focus(); }, []);
  function newAttempt(question: string, parent = parentRequest): Attempt {
    return { idempotencyKey: crypto.randomUUID(), question, conversation: { id: conversationId, ...(parent ? { parentRequestId: parent } : {}) } };
  }
  function followUp(action: QueryAction, turn: Turn) {
    const source = turn.reply?.conversation ?? turn.attempt.conversation;
    if (!turn.reply?.requestId || source?.id !== conversationId) return;
    void run(newAttempt(action.question, turn.reply.requestId));
  }
  const activeTurn: Turn | null = attempt ? { attempt, reply, message } : null;
  const activeContext = !!attempt && !!reply?.requestId && (reply.conversation ?? attempt.conversation)?.id === conversationId;
  const ready = reply?.status === 'ready' && !!reply.result;
  const retry = attempt && !busy && !reply?.result && reply?.status !== 'clarification';
  const examples = [...new Set(access.examples)];
  return <div className={styles.conversation}>
    {access.enabled && !attempt && !history.length && <div className={styles.welcome}>
      <h3>今天想了解什么？</h3><p>查询楼宇、了解市场指标，或比较季度变化。</p>
      <div className={styles.suggestions}>{examples.slice(0, 4).map(question => <ExampleQuestion key={question} variant="secondary" question={question} onSelect={edit} />)}</div>
    </div>}
    {access.enabled && <div className={styles.transcript}>
      {history.map(turn => <PreviousTurn key={turn.attempt.idempotencyKey} turn={turn} scope={scope} internalExport={access.internalExport === true} onEdit={edit}
        canFollowUp={!busy && (turn.reply?.conversation ?? turn.attempt.conversation)?.id === conversationId} onFollowUp={action => followUp(action, turn)} />)}
      {attempt && <article className={styles.turn} aria-label="本次问答">
        <p className={styles.question}><span className="sr-only">你的问题：</span>{attempt.question || '已恢复的查询'}</p>
        <div className={styles.replyHeading}>Colliers AI <span>{busy ? '正在处理' : reply?.status === 'clarification' ? '需要补充条件' : ready ? '基于授权数据' : '查询状态'}</span></div>
      </article>}
      <div role="status" aria-live="polite" className={ready ? 'sr-only' : styles.status}>{message}</div>
      {activeTurn && activeContext && reply?.status === 'clarification' && <QueryActions label="请选择查询口径" actions={reply.options} disabled={busy} onSelect={action => followUp(action, activeTurn)} />}
      {ready && reply?.result && !collapsed && <HomeQueryResult key={reply.result.resultId} result={reply.result} delivery={reply} requestId={reply.requestId} scope={scope} internalExport={access.internalExport === true} />}
      {activeTurn && activeContext && ready && !collapsed && <QueryActions label="继续分析" actions={suggestions(reply)} disabled={busy} onSelect={action => followUp(action, activeTurn)} />}
      <div className={styles.actions}>
        {retry && <Button variant="secondary" onClick={() => void run(attempt)}>重试本次请求</Button>}
        {savedId && !busy && !ready && <Button variant="ghost" onClick={() => void run({ idempotencyKey: attempt?.idempotencyKey ?? crypto.randomUUID(), question: attempt?.question ?? '', requestId: savedId, conversation: attempt?.conversation }, true)}>检查状态并恢复结果</Button>}
        {attempt && !busy && <Button variant="ghost" onClick={() => edit(attempt.question)}>编辑问题</Button>}
        {ready && attempt && <><Button variant="ghost" onClick={() => void run({ idempotencyKey: crypto.randomUUID(), question: attempt.question, conversation: attempt.conversation ?? { id: conversationId } })} disabled={!attempt.question}>重新查询</Button>
          <Button variant="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开本次结果' : '收起本次结果'}</Button></>}
        {(attempt || history.length > 0) && <Button variant="ghost" disabled={busy} onClick={() => resetConversation(false)}>新对话</Button>}
      </div>
    </div>}
    <div className={`${styles.composer} ${access.enabled ? styles.enabled : ''}`}>
      <textarea ref={input} id="home-query" aria-describedby="home-query-status home-query-notice" disabled={!access.enabled}
        rows={2} maxLength={6000} value={draft} onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        placeholder={access.enabled ? '询问市场，或继续追问：金融街呢？' : '对话查询尚未开放'}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          event.preventDefault();
          if (draft.trim() && !busy) void run(newAttempt(draft));
        }} />
      <div className={styles.composerFooter}>
        <p id="home-query-status">{access.enabled ? 'Enter 发送 · Shift+Enter 换行' : message || (accessError ? '暂时无法核对查询资格，请稍后重进主页。原业务入口仍可使用。' : '目前请使用下方业务入口。')}</p>
        {busy ? <Button size="icon" variant="secondary" aria-label="停止等待" onClick={stopWaiting}><Square size={16} aria-hidden="true" /></Button>
          : <Button size="icon" aria-label="发送问题" disabled={!access.enabled || !draft.trim()} onClick={() => void run(newAttempt(draft))}><ArrowUp size={18} strokeWidth={1.5} aria-hidden="true" /></Button>}
      </div>
    </div>
    {access.enabled && <details className={styles.examples} onToggle={event => setExamplesOpen(event.currentTarget.open)}><summary>探索更多与查询范围</summary>
      <div>{examplesOpen && examples.slice(4).map(question => <ExampleQuestion key={question} variant="ghost" question={question} onSelect={edit} />)}</div>
      <p>楼宇目录按当前获权范围查询；季度指标采用当前跟踪样本。示例年份仅说明格式，不代表该期一定有数据。</p>
      <p>本页保留最近 10 次问答，可沿用上文的地区、指标和期间继续追问。选择“新对话”可清除上文条件；离开页面或身份变化后清除本页对话。</p>
    </details>}
    <p id="home-query-notice" className={access.enabled ? styles.privacy : 'sr-only'}>{access.enabled ? '正式提交的提问及回答会留存，供获权审计人员查看。请勿输入密码或密钥。' : '对话查询尚未开放。'}</p>
  </div>;
}
function PreviousTurn({ turn, scope, internalExport, onEdit, canFollowUp, onFollowUp }: { turn: Turn; scope: QueryClientScope; internalExport: boolean; onEdit: (question: string) => void; canFollowUp: boolean; onFollowUp: (action: QueryAction) => void }) {
  const [open, setOpen] = React.useState(false);
  return <article className={styles.previousTurn} aria-label="此前问答">
    <p className={styles.question}><span className="sr-only">你的问题：</span>{turn.attempt.question || '已恢复的查询'}</p>
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Colliers AI · 查看此前回答</summary>
      {open && (turn.reply?.status === 'ready' && turn.reply.result
        ? <HomeQueryResult result={turn.reply.result} delivery={turn.reply} requestId={turn.reply.requestId} scope={scope} internalExport={internalExport} />
        : <p>{turn.message}</p>)}
      {open && turn.reply?.requestId && <QueryActions label={turn.reply.status === 'clarification' ? '请选择查询口径' : '基于这条回答继续分析'}
        actions={turn.reply.status === 'clarification' ? turn.reply.options : suggestions(turn.reply)} disabled={!canFollowUp} onSelect={onFollowUp} />}
      <Button variant="ghost" onClick={() => onEdit(turn.attempt.question)}>编辑这个问题</Button>
    </details>
  </article>;
}
function suggestions(reply: QueryReply | null): QueryAction[] {
  const parsed = queryActionSchema.array().max(6).safeParse(reply?.result?.parameters.suggestions);
  return parsed.success ? parsed.data : [];
}
function ExampleQuestion({ question, variant, onSelect }: { question: string; variant: 'ghost' | 'secondary'; onSelect: (question: string) => void }) {
  return <Button variant={variant} onClick={() => onSelect(question)}>{question}</Button>;
}
function QueryActions({ actions, label, disabled, onSelect }: { actions?: QueryAction[]; label: string; disabled: boolean; onSelect: (action: QueryAction) => void }) {
  if (!actions?.length) return null;
  return <section className={styles.followUps} aria-label={label}><p>{label}</p><div className={styles.actions}>
    {actions.map(action => <Button key={action.id} variant="secondary" disabled={disabled} onClick={() => onSelect(action)}>{action.label}</Button>)}
  </div></section>;
}
