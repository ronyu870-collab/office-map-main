'use client';

import React, { useEffect, useState, useRef } from 'react';
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
      user_email: userEmail, user_name: userName, content: msgContent,
    });
    if (error) { console.error('发送留言失败:', error); }
    else { logAction(userEmail, 'POST_MESSAGE', { content: msgContent.slice(0, 50) }); }
  };

  const boardContent = (
    <>
      {/* 头部 - 三段式布局：上 (固定不压缩) */}
      <div className="flex min-h-12 flex-none shrink-0 items-center justify-between border-b border-[#002f61] bg-[#003e7e] px-4 py-3 text-white">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-tight">市场信息交流</h2>
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/70">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            实时更新
          </div>
        </div>
        <button
          onClick={() => setFullscreen(f => !f)}
          className="z-10 rounded-sm p-1.5 text-white/70 transition-[background-color,color] hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          title={fullscreen ? '退出全屏' : '全屏'}
          aria-label={fullscreen ? '退出全屏' : '全屏'}
          type="button"
        >
          {fullscreen
            ? <Minimize2 size={14} strokeWidth={1.5} />
            : <Maximize2 size={14} strokeWidth={1.5} />}
        </button>
      </div>

      {/* 消息区 - 三段式布局：中 (可滚动，关键是 min-h-0！) */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain bg-zinc-50/50 p-4">
        {loading ? (
          <div className="text-center text-xs text-zinc-400">拉取历史记录中…</div>
        ) : messages.length === 0 ? (
          <div className="mt-10 text-center text-xs text-zinc-400">本周暂无动态，快来发第一条吧！</div>
        ) : messages.map((msg) => {
          const isMe = msg.user_email === userEmail;
          const msgDate = new Date(msg.created_at);
          const now = new Date();
          const isToday = msgDate.toDateString() === now.toDateString();
          const timeStr = isToday
            ? msgDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
            : msgDate.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
          return (
            <div key={msg.id} className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <span className="mb-1 pl-1 text-[10px] text-zinc-400"><MaskedText>{msg.user_name}</MaskedText> • {timeStr}</span>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm shadow-sm ${
                isMe
                  ? 'rounded-tr-none border border-blue-200 bg-blue-100 text-blue-900'
                  : 'rounded-tl-none border border-zinc-200 bg-white text-zinc-800'
              }`}>
                {msg.content}
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 - 三段式布局：下 (固定不压缩) */}
      <form onSubmit={handleSendMessage} className="flex flex-none shrink-0 gap-2 border-t border-zinc-200 bg-white p-3">
        <input
          type="text"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          placeholder="分享市场动态、成交快讯或寻求协助…"
          className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none transition-[background-color,border-color,box-shadow] focus:border-primary focus:bg-white focus-visible:ring-2 focus-visible:ring-primary/20"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={!inputText.trim()}
          className="shrink-0 touch-manipulation rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white transition-[background-color,opacity,box-shadow] hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </>
  );

  if (fullscreen) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col h-full overflow-hidden bg-white">
        {boardContent}
      </div>
    );
  }

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200/70 bg-white shadow-sm">
      {boardContent}
    </section>
  );
}
