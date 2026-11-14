'use client';

import * as React from 'react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import { trustedQueryClient, queryScopeKey, type QueryAccess, type QueryClientScope, type QueryReply } from '@/src/services/trustedQueryClient';
import { HomeQueryResult } from './HomeQueryResult';
import { useQueryPresentationReceipt } from './useQueryPresentationReceipt';
import styles from './HomeQuery.module.css';
import workspace from './HomeWorkspace.module.css';

type Attempt = { idempotencyKey: string; question: string; requestId?: string };
const CLOSED: QueryAccess = { enabled: false, examples: [] };

/** Mounted per verified UI session/impersonation identity, never per query. */
export function HomeQuery({ scope }: { scope: QueryClientScope }) {
  const [access, setAccess] = React.useState<QueryAccess>(CLOSED);
  const [accessError, setAccessError] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const [reply, setReply] = React.useState<QueryReply | null>(null);
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
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
    try { const id = sessionStorage.getItem(storageKey); if (id && /^[0-9a-f-]{36}$/.test(id)) initialId = id; } catch { /* No query text/result is stored in the browser. */ }
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
          generation.current++; current.current?.abort(); setBusy(false); setReply(null); setAttempt(null); clearSaved();
          if (changed) setMessage('查询权限已变化，旧结果已收起，请重新查询。');
        }
      } catch {
        if (controller.signal.aborted || !alive.current) return;
        setAccess(CLOSED); setAccessError(true); setReply(null);
        generation.current++; current.current?.abort(); setBusy(false);
      }
    };
    void refresh();
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const timer = window.setInterval(focus, 30000);
    return () => { alive.current = false; previous?.abort(); current.current?.abort(); window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  }, [scope, storageKey, clearSaved]);

  async function run(next: Attempt, recovering = false) {
    if (current.current || !access.enabled || composing.current) return;
    const controller = new AbortController(); current.current = controller;
    const ticket = ++generation.current;
    setBusy(true); setCollapsed(false); setMessage(recovering ? '正在核对当前权限并恢复原结果…' : '正在查数并记录来源…'); setReply(null); setAttempt(next);
    try {
      const result = recovering && next.requestId ? await trustedQueryClient.recover(scope, next.requestId, controller.signal)
        : await trustedQueryClient.submit(scope, { idempotencyKey: next.idempotencyKey, question: next.question }, controller.signal);
      if (!alive.current || ticket !== generation.current || controller.signal.aborted) return;
      const updated = { ...next, requestId: result.requestId ?? next.requestId }; setAttempt(updated);
      if (updated.requestId) {
        setSavedId(updated.requestId); try { sessionStorage.setItem(storageKey, updated.requestId); } catch { /* Restoration remains available in this mounted view. */ }
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
  const retry = attempt && !busy && !reply?.result && reply?.status !== 'clarification';
  return <>
    <div className={`${workspace.composer} ${access.enabled ? styles.enabled : ''}`}>
      <textarea ref={input} id="home-query" aria-describedby="home-query-status home-query-notice" disabled={!access.enabled}
        rows={access.enabled ? 3 : 2} maxLength={6000} value={draft} onChange={event => setDraft(event.target.value)}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
        placeholder={access.enabled ? `例如：${access.examples[1] ?? access.examples[0] ?? '全部获权楼宇有哪些楼'}？` : '对话查询尚未开放'}
        onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && !composing.current && draft.trim() && !busy) { event.preventDefault(); void run({ idempotencyKey: crypto.randomUUID(), question: draft }); } }} />
      <div className={styles.composerFooter}>
        <p id="home-query-status">{access.enabled ? '从有权访问的数据中查询，条件不明确时会提示补充。' : accessError ? '暂时无法核对查询资格，请稍后重进主页。原业务入口仍可使用。' : '目前请使用下方业务入口。'}</p>
        <Button size="icon" aria-label="发送问题" disabled={!access.enabled || !draft.trim() || busy} onClick={() => void run({ idempotencyKey: crypto.randomUUID(), question: draft })}><ArrowUp size={18} strokeWidth={1.5} aria-hidden="true" /></Button>
      </div>
    </div>
    <p id="home-query-notice" className={access.enabled ? styles.notice : 'sr-only'}>{access.enabled ? '正式提交的提问及回答会留存，供获权审计人员查看。请勿输入密码或密钥。' : '对话查询尚未开放。'}</p>
    {access.enabled && <>
      <details className={styles.examples}><summary>查看提问示例与查询范围</summary>
        <p>示例只说明支持的格式，不代表一定有数据；查询范围以当前权限为准。暂不支持连续追问、省略条件或多问题合并。</p>
        <div>{access.examples.map(question => <Button variant="ghost" key={question} onClick={() => { setDraft(question); input.current?.focus(); }}>{question}</Button>)}</div>
      </details>
      <div role="status" aria-live="polite" className={styles.status}>{message}</div>
      <div className={styles.actions}>
        {busy && <Button variant="secondary" onClick={stopWaiting}>停止等待</Button>}
        {retry && <Button variant="secondary" onClick={() => void run(attempt)}>重试本次请求</Button>}
        {savedId && !busy && <Button variant="ghost" onClick={() => void run({ idempotencyKey: attempt?.idempotencyKey ?? crypto.randomUUID(), question: attempt?.question ?? '', requestId: savedId }, true)}>检查状态并恢复结果</Button>}
        {reply?.result && <Button variant="ghost" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>{collapsed ? '展开本次结果' : '收起本次结果'}</Button>}
      </div>
      {reply?.status === 'ready' && reply.result && !collapsed && <><p className={styles.notice}>以下保留本次已提交查询的结果，不随输入框中的新草稿改变。</p><HomeQueryResult key={reply.result.resultId} result={reply.result} delivery={reply} requestId={reply.requestId} scope={scope} internalExport={access.internalExport === true} /></>}
    </>}
  </>;
}
