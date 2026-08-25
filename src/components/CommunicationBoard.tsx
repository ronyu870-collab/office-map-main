'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { supabase } from '@/src/services/supabaseClient';
import { logAction } from '@/src/utils/audit';
import { MaskedText } from '@/src/components/demo';

type Message = {
  id: number;
  user_email: string;
  user_name: string;
  content: string;
  created_at: string;
};

interface CommunicationBoardProps {
  userEmail: string;
  userName: string;
}

export function CommunicationBoard({ userEmail, userName }: CommunicationBoardProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    const fetchInitialData = async () => {
      const { data } = await supabase
        .from('messages').select('*')
        .order('created_at', { ascending: false }).limit(50);

      if (data) setMessages(data.reverse());
      setLoading(false);
      setTimeout(scrollToBottom, 100);
    };

    fetchInitialData();

    const channel = supabase
      .channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        setMessages((prev) => [...prev, payload.new as Message]);
        setTimeout(scrollToBottom, 100);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    const msgContent = inputText.trim();
    setInputText('');
    const { error } = await supabase.from('messages').insert({
      user_email: userEmail,
      user_name: userName,
      content: msgContent,
    });

    if (error) {
      console.error('发送留言失败:', error);
    } else {
      logAction(userEmail, 'POST_MESSAGE', { content: msgContent.slice(0, 50) });
    }
  };

  const visibleMessages = fullscreen ? messages : messages.slice(-6);

  const boardContent = (
    <>
      <div className="flex min-h-10 flex-none shrink-0 items-center justify-between border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 py-2">
        <h2 className="truncate text-[13px] font-medium text-[var(--cd-color-text-primary)]">市场交流</h2>
        <button
          onClick={() => setFullscreen((value) => !value)}
          className="inline-flex items-center gap-1.5 rounded-[var(--cd-radius-sm)] px-1.5 py-1 text-xs text-[var(--cd-color-text-muted)] transition-colors hover:bg-[var(--cd-color-surface-alt)] hover:text-[var(--cd-color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25"
          title={fullscreen ? '退出全屏' : '展开全部'}
          aria-label={fullscreen ? '退出全屏' : '展开全部'}
          type="button"
        >
          {fullscreen ? <Minimize2 size={13} strokeWidth={1.5} /> : <Maximize2 size={13} strokeWidth={1.5} />}
          <span>{fullscreen ? '收起' : '展开'}</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--cd-color-surface)]">
        {loading ? (
          <div className="px-4 py-8 text-center text-xs text-[var(--cd-color-text-muted)]">正在加载历史信息…</div>
        ) : visibleMessages.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs leading-5 text-[var(--cd-color-text-muted)]">暂无团队动态</div>
        ) : visibleMessages.map((msg) => {
          const isMe = msg.user_email === userEmail;
          const msgDate = new Date(msg.created_at);
          const now = new Date();
          const isToday = msgDate.toDateString() === now.toDateString();
          const timeStr = isToday
            ? msgDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : msgDate.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

          return (
            <div key={msg.id} className={`border-b border-[var(--cd-color-border)] px-3.5 py-3 last:border-b-0 ${isMe ? 'bg-[var(--cd-color-brand-soft)]/35' : 'bg-[var(--cd-color-surface)]'}`}>
              <div className="flex min-w-0 items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs font-medium text-[var(--cd-color-text-secondary)]"><MaskedText>{msg.user_name}</MaskedText></span>
                <span className="shrink-0 text-xs tabular-nums text-[var(--cd-color-text-muted)]">{timeStr}</span>
              </div>
              <p className="mt-1 text-[13px] leading-5 text-[var(--cd-color-text-primary)]">{msg.content}</p>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSendMessage} className="flex flex-none shrink-0 gap-2 border-t border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] p-3">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="分享市场动态…"
          className="min-w-0 flex-1 rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)] px-3 py-2 text-[13px] text-[var(--cd-color-text-primary)] outline-none transition-[background-color,border-color,box-shadow] placeholder:text-[var(--cd-color-text-muted)] focus:border-[var(--cd-color-brand)] focus:bg-[var(--cd-color-surface)] focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/15"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="shrink-0 touch-manipulation rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3.5 py-2 text-[13px] font-medium text-white transition-[background-color,opacity] hover:bg-[var(--cd-color-brand-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/30 disabled:cursor-not-allowed disabled:opacity-45"
        >
          发送
        </button>
      </form>
    </>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex h-full flex-col overflow-hidden bg-[var(--cd-color-surface)]">
        {boardContent}
      </div>
    );
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-[var(--cd-color-surface)]">
      {boardContent}
    </section>
  );
}
