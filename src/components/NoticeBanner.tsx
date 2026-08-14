'use client';

import * as React from 'react';
import { getAllActiveNotices } from '@/src/services/apiClient';
import type { NoticeRow } from '@/src/services/apiClient';

export function NoticeBanner() {
  const [notices, setNotices] = React.useState<NoticeRow[] | null>(null); // null = loading
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      setNotices([]); // timeout → treat as empty
    }, 3000);

    getAllActiveNotices()
      .then((data) => {
        clearTimeout(timeoutId);
        setNotices(data);
        if (data.length > 0) requestAnimationFrame(() => setVisible(true));
      })
      .catch(() => {
        clearTimeout(timeoutId);
        setNotices([]);
      });

    return () => clearTimeout(timeoutId);
  }, []);

  // Loading skeleton
  if (notices === null) {
    return (
      <div className="flex items-center rounded-md border border-blue-100/60 bg-blue-50/50 overflow-hidden h-[38px]">
        <div className="flex shrink-0 items-center gap-1.5 border-r border-blue-100/60 bg-blue-100/60 px-3 self-stretch">
          <div className="h-3 w-14 rounded bg-blue-200/70 animate-pulse" />
        </div>
        <div className="flex-1 px-4">
          <div className="h-3 w-48 rounded bg-blue-100 animate-pulse" />
        </div>
      </div>
    );
  }

  if (notices.length === 0) return null;

  // Build the inner content: notices joined by separators
  const inner = (
    <span className="flex items-center gap-8 px-8">
      {notices.map((n, i) => (
        <React.Fragment key={n.id}>
          {i > 0 && (
            <span className="text-blue-300 select-none" aria-hidden>·</span>
          )}
          <span className="inline-flex items-baseline gap-2">
            <span className="text-[10px] font-medium text-blue-400 tabular-nums shrink-0">
              {new Date(n.updated_at).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })}
            </span>
            <span className="text-[13px] text-blue-900/75">{n.content}</span>
          </span>
        </React.Fragment>
      ))}
    </span>
  );

  return (
    <div
      className={`notice-banner transition-[opacity,transform] duration-500 ease-out ${visible ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0'}`}
      aria-live="polite"
    >
      <div className="flex items-center rounded-md border border-blue-100/60 bg-blue-50/50 overflow-hidden">
        {/* 左侧标签 */}
        <div className="flex shrink-0 items-center gap-1.5 border-r border-blue-100/60 bg-blue-100/60 px-3 py-2.5 self-stretch">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 shrink-0 text-blue-600"
            aria-hidden
          >
            <path d="M22 8.5c0-2.5-2-4.5-4.5-4.5S13 6 13 8.5v7c0 2.5 2 4.5 4.5 4.5S22 18 22 15.5v-7Z" />
            <path d="M13 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h10" />
            <path d="M7 15v4" />
          </svg>
          <span className="text-[11px] font-semibold tracking-wide text-blue-600 whitespace-nowrap">
            系统公告
          </span>
        </div>

        {/* 跑马灯区域 */}
        <div className="marquee-wrapper flex overflow-hidden whitespace-nowrap w-full relative">
          {/* 原版 */}
          <div className="animate-marquee min-w-full flex-shrink-0 flex items-center py-2.5">
            {inner}
          </div>
          {/* 克隆版，紧跟其后实现无缝循环 */}
          <div className="animate-marquee min-w-full flex-shrink-0 flex items-center py-2.5" aria-hidden>
            {inner}
          </div>
        </div>
      </div>
    </div>
  );
}
