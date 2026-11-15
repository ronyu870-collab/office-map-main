'use client';

import * as React from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, queryScopeKey, type QueryAccess, type QueryClientScope, type QueryReply } from '@/src/services/trustedQueryClient';
import { HomeQueryResult } from './HomeQueryResult';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';

type Attempt = { idempotencyKey: string; question: string; requestId?: string };
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
  const input = React.useRef<HTMLTextAreaElement>(null);
  const composing = React.useRef(false), alive = React.useRef(true);
  const current = React.useRef<AbortController | null>(null);
  const generation = React.useRef(0), revision = React.useRef<string | undefined>(undefined);
  useQueryPresentationReceipt(scope, reply, access.enabled && reply?.status === 'clarification' ? { surface: 'clarification' } : null);
  const storageKey = `trusted-query:last:${queryScopeKey(scope)}`;
  const clearSaved = React.useCallback(() => { setSavedId(null); try { sessionStorage.removeItem(storageKey); } catch { /* Storage is optional. */ } }, [storageKey]);

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
          generation.current++; current.current?.abort(); current.current = null;
          setBusy(false); setReply(null); setAttempt(null); setHistory([]); setDraft(''); clearSaved();
          if (changed) setMessage('查询权限已变化，旧结果已收起，请重新查询。');
        }
      } catch {
        if (controller.signal.aborted || !alive.current) return;
        setAccess(CLOSED); setAccessError(true); setReply(null); setHistory([]); setAttempt(null);
        generation.current++; current.current?.abort(); current.current = null; setBusy(false);
      }
    };
    void refresh();
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const timer = window.setInterval(focus, 30000);
    return () => { alive.current = false; previous?.abort(); current.current?.abort(); current.current = null; window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [scope, storageKey, clearSaved]);
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
        : await trustedQueryClient.submit(scope, { idempotencyKey: next.idempotencyKey, question: next.question }, controller.signal);
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      const updated = { ...next, requestId: result.requestId ?? next.requestId }; setAttempt(updated);
      if (updated.requestId) {
        setSavedId(updated.requestId); try { sessionStorage.setItem(storageKey, updated.requestId); } catch { /* Recovery also works in this mounted session. */ }
      }
      setReply(result);
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
  function edit(question: string) { setDraft(question); input.current?.focus(); }
  const ready = reply?.status === 'ready' && !!reply.result;
  const retry = attempt && !busy && !reply?.result && reply?.status !== 'clarification';
  const examples = [...new Set(access.examples)];
  return <div className={styles.conversation}>
    {access.enabled && !attempt && !history.length && <div className={styles.welcome}>
      <h3>今天想了解什么？</h3><p>查询楼宇、了解市场指标，或比较季度变化。</p>
      <div className={styles.suggestions}>{examples.slice(0, 4).map(question => <Button variant="secondary" key={question} onClick={() => edit(question)}>{question}</Button>)}</div>
    </div>}
    {access.enabled && <div className={styles.transcript}>
      {history.map(turn => <PreviousTurn key={turn.attempt.idempotencyKey} turn={turn} scope={scope} internalExport={access.internalExport === true} onEdit={edit} />)}
      {attempt && <article className={styles.turn} aria-label="本次问答">
        <p className={styles.question}><span className="sr-only">你的问题：</span>{attempt.question || '已恢复的查询'}</p>
        <div className={styles.replyHeading}>Colliers AI <span>{busy ? '正在处理' : reply?.status === 'clarification' ? '需要补充条件' : ready ? '基于授权数据' : '查询状态'}</span></div>
      </article>}
      <div role="status" aria-live="polite" className={ready ? 'sr-only' : styles.status}>{message}</div>
      {ready && reply?.result && !collapsed && <HomeQueryResult key={reply.result.resultId} result={reply.result} delivery={reply} requestId={reply.requestId} scope={scope} internalExport={access.internalExport === true} />}
      <div className={styles.actions}>
        {retry && <Button variant="secondary" onClick={() => void run(attempt)}>重试本次请求</Button>}
        {savedId && !busy && !ready && <Button variant="ghost" onClick={() => void run({ idempotencyKey: attempt?.idempotencyKey ?? crypto.randomUUID(), question: attempt?.question ?? '', requestId: savedId }, true)}>检查状态并恢复结果</Button>}
        {attempt && !busy && <Button variant="ghost" onClick={() => edit(attempt.question)}>编辑问题</Button>}
        {ready && attempt && <><Button variant="ghost" onClick={() => void run({ idempotencyKey: crypto.randomUUID(), question: attempt.question })} disabled={!attempt.question}>重新查询</Button>
          <Button variant="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开本次结果' : '收起本次结果'}</Button></>}
      </div>
    </div>}
    <div className={`${styles.composer} ${access.enabled ? styles.enabled : ''}`}>
      <textarea ref={input} id="home-query" aria-describedby="home-query-status home-query-notice" disabled={!access.enabled}
        rows={2} maxLength={6000} value={draft} onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        placeholder={access.enabled ? '输入完整问题，例如：2026Q3 CBD净有效租金' : '对话查询尚未开放'}
        onKeyDown={event => {
          if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composing.current || event.keyCode === 229) return;
          event.preventDefault();
          if (draft.trim() && !busy) void run({ idempotencyKey: crypto.randomUUID(), question: draft });
        }} />
      <div className={styles.composerFooter}>
        <p id="home-query-status">{access.enabled ? 'Enter 发送 · Shift+Enter 换行' : accessError ? '暂时无法核对查询资格，请稍后重进主页。原业务入口仍可使用。' : '目前请使用下方业务入口。'}</p>
        {busy ? <Button size="icon" variant="secondary" aria-label="停止等待" onClick={stopWaiting}><Square size={16} aria-hidden="true" /></Button>
          : <Button size="icon" aria-label="发送问题" disabled={!access.enabled || !draft.trim()} onClick={() => void run({ idempotencyKey: crypto.randomUUID(), question: draft })}><ArrowUp size={18} strokeWidth={1.5} aria-hidden="true" /></Button>}
      </div>
    </div>
    {access.enabled && <details className={styles.examples} onToggle={event => setExamplesOpen(event.currentTarget.open)}><summary>探索更多与查询范围</summary>
      <div>{examplesOpen && examples.slice(4).map(question => <Button variant="ghost" key={question} onClick={() => edit(question)}>{question}</Button>)}</div>
      <p>楼宇目录按当前获权范围查询；季度指标采用当前跟踪样本。示例年份仅说明格式，不代表该期一定有数据。</p>
      <p>本页保留最近 10 次问答，离开页面后清除。每次仍需写全地区、指标和季度，暂不自动继承上文条件。</p>
    </details>}
    <p id="home-query-notice" className={access.enabled ? styles.privacy : 'sr-only'}>{access.enabled ? '正式提交的提问及回答会留存，供获权审计人员查看。请勿输入密码或密钥。' : '对话查询尚未开放。'}</p>
  </div>;
}
function PreviousTurn({ turn, scope, internalExport, onEdit }: { turn: Turn; scope: QueryClientScope; internalExport: boolean; onEdit: (question: string) => void }) {
  const [open, setOpen] = React.useState(false);
  return <article className={styles.previousTurn} aria-label="此前问答">
    <p className={styles.question}><span className="sr-only">你的问题：</span>{turn.attempt.question || '已恢复的查询'}</p>
    <details onToggle={event => setOpen(event.currentTarget.open)}><summary>Colliers AI · 查看此前回答</summary>
      {open && (turn.reply?.status === 'ready' && turn.reply.result
        ? <HomeQueryResult result={turn.reply.result} delivery={turn.reply} requestId={turn.reply.requestId} scope={scope} internalExport={internalExport} />
        : <p>{turn.message}</p>)}
      <Button variant="ghost" onClick={() => onEdit(turn.attempt.question)}>编辑这个问题</Button>
    </details>
  </article>;
}
