'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '@/src/services/supabaseClient';
import { CommunicationComposer } from '@/src/components/CommunicationComposer';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { normalizeMarketSegments, segmentText, type MarketSegment } from '@/src/lib/communication/segments';
import { MaskedText } from '@/src/components/demo';

type Message = {
  id: number;
  user_email: string;
  user_name: string;
  content: string;
  created_at: string;
  rich_segments?: unknown;
  reply_to_id?: number | null;
  mention_everyone?: boolean;
};

interface CommunicationBoardProps {
  userEmail: string;
  userName: string;
}

const MAX_MESSAGES = 50;
const BEIJING_TIME_ZONE = 'Asia/Shanghai';
const HISTORY_STATE_KEY = '__colliersCommunicationFullscreen';

function formatMessageTime(value: string) {
  const date = new Date(value);
  const now = new Date();
  const dayFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const yearFormatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
  });
  const isToday = dayFormatter.format(date) === dayFormatter.format(now);
  const isCurrentYear = yearFormatter.format(date) === yearFormatter.format(now);

  return isToday
    ? date.toLocaleTimeString('zh-CN', {
        timeZone: BEIJING_TIME_ZONE,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : date.toLocaleString('zh-CN', {
        timeZone: BEIJING_TIME_ZONE,
        ...(isCurrentYear ? {} : { year: 'numeric' as const }),
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
}

export function CommunicationBoard({ userEmail }: CommunicationBoardProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [replyToId, setReplyToId] = useState<number | null>(null);
  const [unreadMentions, setUnreadMentions] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const toggleButtonRef = useRef<HTMLButtonElement>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);
  const draftSegmentsRef = useRef<MarketSegment[]>([]);
  const fullscreenRef = useRef(false);
  const historyEntryRef = useRef(false);
  const wasFullscreenRef = useRef(false);
  const isNearBottomRef = useRef(true);
  const sendingRef = useRef(false);
  const mountedRef = useRef(true);
  const loadRequestIdRef = useRef(0);
  const animationFramesRef = useRef<Set<number>>(new Set());

  const scheduleFrame = useCallback((callback: () => void) => {
    const frameId = requestAnimationFrame(() => {
      animationFramesRef.current.delete(frameId);
      if (mountedRef.current) callback();
    });
    animationFramesRef.current.add(frameId);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      loadRequestIdRef.current += 1;
      animationFramesRef.current.forEach((frameId) => cancelAnimationFrame(frameId));
      animationFramesRef.current.clear();
    };
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    // Keep initial/realtime updates inside the board; scrollIntoView also scrolls the homepage.
    const viewport = messagesViewportRef.current;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior });
    isNearBottomRef.current = true;
    setHasNewMessages(false);
  }, []);

  const loadMessages = useCallback(async () => {
    const requestId = ++loadRequestIdRef.current;
    setLoading(true);
    setLoadError(false);

    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(MAX_MESSAGES);

    if (!mountedRef.current || requestId !== loadRequestIdRef.current) return;

    if (error) {
      console.error('加载市场交流失败:', error);
      setLoadError(true);
      setLoading(false);
      return;
    }

    setMessages((data ?? []).reverse());
    setLoading(false);
    scheduleFrame(() => scrollToBottom('auto'));
  }, [scheduleFrame, scrollToBottom]);

  const refreshMentions = useCallback(async () => {
    const { data, error } = await supabase
      .from('message_notifications')
      .select('message_id')
      .is('read_at', null)
      .order('created_at', { ascending: false })
      .limit(100);
    if (!error && mountedRef.current) setUnreadMentions((data ?? []).length);
  }, []);

  useEffect(() => {
    void loadMessages();
    void refreshMentions();

    const channel = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        if (!mountedRef.current) return;

        setLoadError(false);
        const incomingMessage = payload.new as Message;
        setMessages((prev) => {
          if (prev.some((message) => message.id === incomingMessage.id)) return prev;
          return [...prev, incomingMessage].slice(-MAX_MESSAGES);
        });

        void refreshMentions();
        scheduleFrame(() => {
          if (!fullscreenRef.current || isNearBottomRef.current) {
            scrollToBottom(fullscreenRef.current ? 'smooth' : 'auto');
          } else {
            setHasNewMessages(true);
          }
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadMessages, refreshMentions, scheduleFrame, scrollToBottom]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const shouldBeFullscreen = Boolean(event.state?.[HISTORY_STATE_KEY]);
      historyEntryRef.current = shouldBeFullscreen;
      fullscreenRef.current = shouldBeFullscreen;
      setFullscreen(shouldBeFullscreen);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const openFullscreen = useCallback(() => {
    if (fullscreenRef.current) return;

    fullscreenRef.current = true;
    const currentState = window.history.state && typeof window.history.state === 'object'
      ? window.history.state
      : {};
    window.history.pushState({ ...currentState, [HISTORY_STATE_KEY]: true }, '');
    historyEntryRef.current = true;
    setFullscreen(true);
  }, []);

  const closeFullscreen = useCallback(() => {
    fullscreenRef.current = false;
    setFullscreen(false);
    setHasNewMessages(false);

    if (historyEntryRef.current) {
      historyEntryRef.current = false;
      window.history.back();
    }
  }, []);

  useEffect(() => {
    if (!fullscreen) {
      if (wasFullscreenRef.current) {
        wasFullscreenRef.current = false;
        scheduleFrame(() => toggleButtonRef.current?.focus());
      }
      return;
    }

    wasFullscreenRef.current = true;
    const previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    scheduleFrame(() => {
      scrollToBottom('auto');
      toggleButtonRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeFullscreen();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current) return;

      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [contenteditable="true"], input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute('aria-hidden'));

      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [closeFullscreen, fullscreen, scheduleFrame, scrollToBottom]);

  const handleViewportScroll = () => {
    const viewport = messagesViewportRef.current;
    if (!viewport) return;

    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const nearBottom = distanceFromBottom < 72;
    isNearBottomRef.current = nearBottom;
    if (nearBottom) setHasNewMessages(false);
  };

  const handleSendMessage = async (segments: MarketSegment[]): Promise<boolean> => {
    const msgContent = segmentText(segments);
    if (!msgContent.trim() || sendingRef.current) return false;
    sendingRef.current = true;
    setSending(true);
    setSendError(null);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('登录状态已失效，请重新登录');
      const result = await fetch('/api/communication', {
        method: 'POST',
        headers: withImpersonationHeaders({
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        }),
        cache: 'no-store',
        body: JSON.stringify({ segments, replyToId }),
      });
      if (!result.ok) {
        const body = await result.json().catch(() => ({}));
        throw new Error(typeof body.error === 'string' ? body.error : '发送失败');
      }
      if (mountedRef.current) {
        setReplyToId(null);
        void refreshMentions();
      }
      return true;
    } catch (error) {
      console.error('发送留言失败:', error);
      if (mountedRef.current) {
        setSendError(error instanceof Error && error.message !== '发送失败'
          ? `${error.message}，内容已保留。` : '发送失败，内容已保留，请重试。');
      }
      return false;
    } finally {
      sendingRef.current = false;
      if (mountedRef.current) setSending(false);
    }
  };

  const markVisibleMentionsRead = useCallback(async () => {
    const ids = messages.map(message => message.id);
    if (!ids.length) return;
    const { error } = await supabase
      .from('message_notifications')
      .update({ read_at: new Date().toISOString() })
      .in('message_id', ids);
    if (!error) void refreshMentions();
  }, [messages, refreshMentions]);

  useEffect(() => {
    if (fullscreen && unreadMentions > 0) void markVisibleMentionsRead();
  }, [fullscreen, markVisibleMentionsRead, unreadMentions]);

  const visibleMessages = fullscreen ? messages : messages.slice(-4);

  const boardContent = (
    <>
      <div className="flex min-h-10 flex-none shrink-0 items-center justify-between border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 py-2">
        <div className="min-w-0">
          <h2 id={fullscreen ? 'communication-dialog-title' : undefined} className="truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]">市场交流</h2>
          {fullscreen ? <div className="mt-0.5 text-[11px] text-[var(--cd-color-text-muted)]">最近 {MAX_MESSAGES} 条</div> : null}
        </div>
        <div className="flex items-center gap-2">
          {unreadMentions > 0 ? (
            <span className="rounded-[var(--cd-radius-sm)] bg-[var(--cd-color-brand-soft)] px-2 py-1 text-xs font-medium text-[var(--cd-color-brand)]" aria-live="polite">
              {unreadMentions} 条提及
            </span>
          ) : null}
        <button
          ref={toggleButtonRef}
          onClick={fullscreen ? closeFullscreen : openFullscreen}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-2 text-xs text-[var(--cd-color-text-muted)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25"
          title={fullscreen ? '退出市场交流' : `打开市场交流（最近 ${MAX_MESSAGES} 条）`}
          aria-label={fullscreen ? '退出市场交流' : `打开市场交流（最近 ${MAX_MESSAGES} 条）`}
          type="button"
        >
          {fullscreen ? <Minimize2 size={13} strokeWidth={1.5} /> : <Maximize2 size={13} strokeWidth={1.5} />}
          <span>{fullscreen ? '退出' : '查看交流'}</span>
        </button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1">
        <div
          ref={messagesViewportRef}
          onScroll={handleViewportScroll}
          className="h-full overflow-y-auto overscroll-contain bg-[var(--cd-color-surface)]"
        >
          {loading ? (
            <div className="px-4 py-8 text-center text-xs text-[var(--cd-color-text-muted)]">正在加载市场交流…</div>
          ) : loadError ? (
            <div className="px-4 py-7 text-center">
              <p className="text-xs text-[var(--cd-color-text-secondary)]">市场交流暂时无法加载</p>
              <button
                type="button"
                onClick={() => void loadMessages()}
                className="mt-2 min-h-9 rounded-[var(--cd-radius-sm)] px-2.5 text-xs font-medium text-[var(--cd-color-brand)] hover:bg-[var(--cd-color-brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25"
              >
                重试
              </button>
            </div>
          ) : visibleMessages.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs leading-5 text-[var(--cd-color-text-muted)]">暂无市场交流</div>
          ) : visibleMessages.map((msg) => {
            const isMe = msg.user_email === userEmail;
            const segments = normalizeMarketSegments(msg.rich_segments);
            const parent = msg.reply_to_id ? messages.find(item => item.id === msg.reply_to_id) : null;
            return (
              <div key={msg.id} className={`border-b border-[var(--cd-color-border)] px-3.5 py-3 last:border-b-0 ${fullscreen && isMe ? 'bg-[var(--cd-color-brand-soft)]/35' : 'bg-[var(--cd-color-surface)]'}`}>
                <div className="flex min-w-0 items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-xs font-medium text-[var(--cd-color-text-secondary)]"><MaskedText>{msg.user_name}</MaskedText></span>
                  <span className="shrink-0 text-xs tabular-nums text-[var(--cd-color-text-muted)]">{formatMessageTime(msg.created_at)}</span>
                </div>
                
                {parent ? <div className="mt-1 border-l-2 border-[var(--cd-color-border)] pl-2 text-xs text-[var(--cd-color-text-secondary)]">
                  回复 {parent.user_name || '同事'}：{parent.content.slice(0, 55)}
                </div> : msg.reply_to_id ? <div className="mt-1 text-xs text-[var(--cd-color-text-muted)]">回复较早消息</div> : null}
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-5 text-[var(--cd-color-text-primary)] [overflow-wrap:anywhere]">
                  {segments && segmentText(segments) === msg.content ? segments.map((part, index) => (
                    <span key={index} className={`${part.bold ? 'font-bold' : ''} ${part.mentionUserId || part.everyone ? 'rounded-[3px] bg-[var(--cd-color-brand-soft)] px-0.5' : ''}`}
                      style={part.color === 'blue' ? { color: '#003e7e' } : part.color === 'red' ? { color: '#c9362b' } : part.color === 'green' ? { color: '#16855b' } : part.mentionUserId || part.everyone ? { color: '#003e7e' } : undefined}>
                      {part.text}
                    </span>
                  )) : msg.content}
                </p>
                <button type="button" onClick={() => setReplyToId(msg.id)}
                  className="mt-1 inline-flex min-h-8 items-center rounded-[var(--cd-radius-sm)] px-1 text-xs text-[var(--cd-color-text-secondary)] hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25">
                  回复
                </button>
              </div>
            );
          })}
        </div>

        {fullscreen && hasNewMessages ? (
          <button
            type="button"
            onClick={() => scrollToBottom('smooth')}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3 py-1.5 text-xs font-medium text-[var(--cd-color-brand)] shadow-[var(--cd-shadow-popover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25"
          >
            有新消息
          </button>
        ) : null}
      </div>

      <div className={fullscreen
        ? "shrink-0 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        : "shrink-0 bg-[var(--cd-color-surface)] px-1"}>
        <CommunicationComposer
          onSend={handleSendMessage}
          draftRef={draftSegmentsRef}
          sending={sending}
          sendError={sendError}
          reply={replyToId === null ? null : (() => {
            const message = messages.find(item => item.id === replyToId);
            return message ? { id: message.id, name: message.user_name || '同事', content: message.content } : null;
          })()}
          onClearReply={() => setReplyToId(null)}
        />
      </div>
    </>
  );

  if (fullscreen) {
    return (
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="communication-dialog-title"
        className="fixed inset-0 z-[var(--cd-z-modal)] flex h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-[var(--cd-color-surface)] pt-[env(safe-area-inset-top)]"
      >
        {boardContent}
      </div>
    );
  }

  return (
    <section className="relative flex h-full flex-col overflow-visible bg-[var(--cd-color-surface)]" aria-label="市场交流摘要">
      {boardContent}
    </section>
  );
}
