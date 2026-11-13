'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AtSign, Bold, Send, X } from 'lucide-react';
import { supabase } from '@/src/services/supabaseClient';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { editorSegments, segmentText, type MarketColor, type MarketMember, type MarketSegment } from '@/src/lib/communication/segments';
import styles from './CommunicationComposer.module.css';

type Reply = { id: number; name: string; content: string };
type Props = {
  onSend: (segments: MarketSegment[]) => Promise<boolean>;
  sending: boolean;
  reply: Reply | null;
  onClearReply: () => void;
  sendError: string | null;
};

const COLOR_HEX: Record<MarketColor, string> = { blue: '#003e7e', red: '#c9362b', green: '#16855b' };
type MentionPosition = { node: Text; start: number; end: number };

export function CommunicationComposer({ onSend, sending, reply, onClearReply, sendError }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionPositionRef = useRef<MentionPosition | null>(null);
  const composingRef = useRef(false);
  const loadingMembersRef = useRef(false);
  const membersLoadedRef = useRef(false);
  const sendingRef = useRef(false);
  const [length, setLength] = useState(0);
  const [members, setMembers] = useState<MarketMember[]>([]);
  const [everyoneAllowed, setEveryoneAllowed] = useState(false);
  const [memberError, setMemberError] = useState(false);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [activeMention, setActiveMention] = useState(0);

  const loadMembers = useCallback(async () => {
    if (membersLoadedRef.current || loadingMembersRef.current) return;
    loadingMembersRef.current = true;
    setMemberError(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('未登录');
      const response = await fetch('/api/communication', {
        headers: withImpersonationHeaders({ Authorization: `Bearer ${session.access_token}` }),
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('directory unavailable');
      const data = await response.json() as {
        members?: MarketMember[]; canMentionEveryone?: boolean;
      };
      if (!Array.isArray(data.members)) throw new Error('invalid directory');
      setMembers(data.members);
      setEveryoneAllowed(Boolean(data.canMentionEveryone));
      membersLoadedRef.current = true;
    } catch {
      setMemberError(true);
    } finally {
      loadingMembersRef.current = false;
    }
  }, []);

  const refreshInput = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    setLength(segmentText(editorSegments(editor)).length);
    if (composingRef.current) return;
    const selection = window.getSelection();
    const node = selection?.anchorNode;
    if (!node || node.nodeType !== Node.TEXT_NODE || !editor.contains(node)) {
      mentionPositionRef.current = null;
      setMentionQuery(null);
      return;
    }
    const textNode = node as Text;
    const cursor = selection?.anchorOffset || 0;
    const before = (textNode.textContent || '').slice(0, cursor);
    const match = before.match(/(?:^|\s)@([^\s@]{0,30})$/u);
    if (!match) {
      mentionPositionRef.current = null;
      setMentionQuery(null);
      return;
    }
    mentionPositionRef.current = { node: textNode, start: cursor - match[0].length + (match[0].startsWith('@') ? 0 : 1), end: cursor };
    setMentionQuery(match[1]);
    setActiveMention(0);
    void loadMembers();
  }, [loadMembers]);

  const candidates = mentionQuery === null ? [] : [
    ...(everyoneAllowed && '所有人'.includes(mentionQuery) ? [{ id: '__everyone__', name: '所有人' }] : []),
    ...members.filter(member => member.name.toLowerCase().includes(mentionQuery.toLowerCase())).slice(0, 8),
  ];

  const insertMention = (member: MarketMember) => {
    const editor = editorRef.current;
    const position = mentionPositionRef.current;
    if (!editor || !position || !editor.contains(position.node)) return;
    editor.focus();
    const range = document.createRange();
    range.setStart(position.node, position.start);
    range.setEnd(position.node, position.end);
    range.deleteContents();
    const token = document.createElement('span');
    token.contentEditable = 'false';
    token.className = styles.mention;
    token.textContent = `@${member.name}`;
    if (member.id === '__everyone__') token.dataset.mentionEveryone = 'true';
    else token.dataset.mentionUserId = member.id;
    range.insertNode(token);
    const space = document.createTextNode(' ');
    token.after(space);
    range.setStartAfter(space);
    range.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    mentionPositionRef.current = null;
    setMentionQuery(null);
    refreshInput();
  };

  const insertText = (text: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    if (document.execCommand('insertText', false, text)) {
      refreshInput();
      return;
    }
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    refreshInput();
  };

  const applyFormat = (name: 'bold' | 'foreColor', value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(name, false, value);
    refreshInput();
  };

  const submit = async () => {
    const editor = editorRef.current;
    if (!editor || sendingRef.current || sending) return;
    const segments = editorSegments(editor);
    const text = segmentText(segments);
    if (!text.trim() || text.length > 2000) return;
    sendingRef.current = true;
    try {
      if (await onSend(segments)) {
        editor.replaceChildren();
        setLength(0);
        mentionPositionRef.current = null;
        setMentionQuery(null);
        editor.focus();
      }
    } finally {
      sendingRef.current = false;
    }
  };

  useEffect(() => {
    if (reply) editorRef.current?.focus();
  }, [reply]);

  return (
    <div className={styles.composer}>
      {reply && (
        <div className={styles.reply}>
          <span className="min-w-0 truncate">回复 <strong>{reply.name}</strong>：{reply.content.slice(0, 60)}</span>
          <button type="button" onClick={onClearReply} aria-label="取消回复" className={styles.iconButton}><X size={14} /></button>
        </div>
      )}
      <div className={styles.editorShell}>
        <div
          ref={editorRef}
          role="textbox"
          aria-label="市场交流消息内容"
          aria-multiline="true"
          aria-invalid={Boolean(sendError)}
          contentEditable={!sending}
          suppressContentEditableWarning
          spellCheck
          className={styles.editor}
          data-placeholder="分享市场动态，输入 @ 提及同事…"
          data-empty={length === 0 ? 'true' : 'false'}
          onInput={refreshInput}
          onCompositionStart={() => { composingRef.current = true; }}
          onCompositionEnd={() => { composingRef.current = false; refreshInput(); }}
          onPaste={event => {
            event.preventDefault();
            insertText(event.clipboardData.getData('text/plain').slice(0, 2000));
          }}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing || composingRef.current) return;
            if (mentionQuery !== null && candidates.length) {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActiveMention(index => (index + 1) % candidates.length); return; }
              if (event.key === 'ArrowUp') { event.preventDefault(); setActiveMention(index => (index - 1 + candidates.length) % candidates.length); return; }
              if (event.key === 'Enter' && !(event.ctrlKey || event.metaKey)) {
                event.preventDefault(); insertMention(candidates[activeMention] || candidates[0]); return;
              }
            }
            if (event.key === 'Escape' && mentionQuery !== null) {
              event.preventDefault(); setMentionQuery(null); return;
            }
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault(); void submit(); return;
            }
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'b') {
              event.preventDefault(); applyFormat('bold');
            }
          }}
        />
        {mentionQuery !== null && (
          <div className={styles.suggestions} role="listbox" aria-label="提及团队成员">
            {memberError ? (
              <button type="button" className={styles.option} onMouseDown={event => event.preventDefault()} onClick={() => { setMemberError(false); void loadMembers(); }}>成员列表加载失败，重试</button>
            ) : candidates.length ? candidates.map((member, index) => (
              <button
                key={member.id} type="button" role="option" aria-selected={index === activeMention}
                className={styles.option} data-active={index === activeMention}
                onMouseDown={event => event.preventDefault()}
                onClick={() => insertMention(member)}
              >@{member.name}{member.id === '__everyone__' ? ' · 全体站内提醒' : ''}</button>
            )) : <div className={styles.noMatches}>暂无匹配成员</div>}
          </div>
        )}
      </div>
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <button type="button" className={styles.iconButton} title="加粗（选中文本或 Ctrl+B）" aria-label="加粗"
            onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('bold')} disabled={sending}>
            <Bold size={16} />
          </button>
          {(['blue','red','green'] as const).map(color => (
            <button key={color} type="button" className={styles.iconButton}
              aria-label={`设为${color === 'blue' ? '蓝色' : color === 'red' ? '红色' : '绿色'}`}
              title="选中文字后设置颜色" onMouseDown={event => event.preventDefault()}
              onClick={() => applyFormat('foreColor', COLOR_HEX[color])} disabled={sending}>
              <span className={styles.swatch} style={{ backgroundColor: COLOR_HEX[color] }} />
            </button>
          ))}
          <button type="button" className={styles.iconButton} aria-label="提及同事" title="提及同事"
            onMouseDown={event => event.preventDefault()} onClick={() => insertText('@')} disabled={sending}>
            <AtSign size={16} />
          </button>
        </div>
        <div className={styles.footer}>
          {length > 1800 && <span aria-live="polite" className={styles.counter}>{length}/2000</span>}
          <button type="button" aria-label="发送市场交流消息" onClick={() => void submit()}
            disabled={sending || length === 0 || length > 2000} className={styles.sendButton}>
            <Send size={14} /> <span>{sending ? '发送中…' : '发送'}</span>
          </button>
        </div>
      </div>
      {sendError && <p role="alert" className={styles.error}>{sendError}</p>}
      <div className={styles.hint}>Enter 换行 · Ctrl/Cmd+Enter 发送</div>
    </div>
  );
}
