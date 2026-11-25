'use client';

import * as React from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/src/components/ui/Button';
import styles from './HomeQuery.module.css';

export type QueryComposerHandle = { value: () => string; setValue: (value: string) => void };
type Props = { editorRef: React.RefObject<HTMLTextAreaElement | null>; composingRef: React.MutableRefObject<boolean>;
  enabled: boolean; busy: boolean; followUp: boolean; status: string; onFocus: () => void;
  onSubmit: () => void; onStop: () => void; handle: React.Ref<QueryComposerHandle> };
/** Draft keystrokes update only the editor, never the conversation/results. The
 * same textarea remains mounted across compact/focus/fullscreen transitions. */
export function HomeQueryComposer({ editorRef, composingRef, enabled, busy, followUp, status, onFocus, onSubmit, onStop, handle }: Props) {
  const [draft, setDraft] = React.useState('');
  React.useImperativeHandle(handle, () => ({ value: () => draft, setValue: setDraft }), [draft]);
  React.useLayoutEffect(() => {
    const node = editorRef.current;
    if (!node) return;
    node.style.height = 'auto';
    const compact = node.closest('[data-mode]')?.getAttribute('data-mode') === 'compact';
    node.style.height = `${Math.max(compact ? 28 : 44, Math.min(node.scrollHeight, 200))}px`;
  }, [draft, enabled, editorRef]);
  return <>
    <textarea ref={editorRef} id="home-query" aria-label="向 Colliers AI 提问" aria-describedby="home-query-status" disabled={!enabled}
      rows={1} maxLength={6000} value={draft} onChange={event => setDraft(event.target.value)}
      onFocus={onFocus} onPointerDown={onFocus}
      onCompositionStart={() => { composingRef.current = true; }} onCompositionEnd={() => { composingRef.current = false; }}
      placeholder={enabled ? (followUp ? '继续追问或换个问题…' : '输入楼宇或市场问题…') : '对话查询尚未开放'}
      onKeyDown={event => {
        if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing || composingRef.current || event.keyCode === 229) return;
        event.preventDefault(); onSubmit();
      }} />
    <div className={styles.composerFooter}>
      <p id="home-query-status" className={enabled ? styles.keyboardHint : undefined}>{enabled ? 'Enter 发送 · Shift+Enter 换行' : status}</p>
      <Button className={styles.sendButton} size="icon" variant={busy ? "secondary" : "primary"}
        aria-label={busy ? "停止等待" : "发送问题"} data-busy={busy}
        disabled={!busy && (!enabled || !draft.trim())} onClick={busy ? onStop : onSubmit}>
        <span className={styles.sendGlyph} aria-hidden="true"><ArrowUp size={20} strokeWidth={1.75} /><Square size={16} strokeWidth={1.75} /></span>
      </Button>
    </div>
  </>;
}
