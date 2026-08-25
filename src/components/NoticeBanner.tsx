'use client';

import * as React from 'react';
import { getAllActiveNotices } from '@/src/services/apiClient';
import type { NoticeRow } from '@/src/services/apiClient';

export function NoticeBanner() {
  const [notices, setNotices] = React.useState<NoticeRow[] | null>(null);
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    const timeoutId = setTimeout(() => setNotices([]), 3000);

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

  if (notices === null) {
    return <div className="h-10 animate-pulse rounded-[var(--cd-radius-md)] bg-[var(--cd-color-surface-alt)]" aria-hidden="true" />;
  }

  if (notices.length === 0) return null;

  return (
    <section className={`rounded-[var(--cd-radius-md)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 py-3 transition-opacity duration-300 ${visible ? 'opacity-100' : 'opacity-0'}`} aria-live="polite" aria-label="系统公告">
      <div className="mb-2 text-xs font-semibold text-[var(--cd-color-text-secondary)]">系统公告</div>
      <div className="space-y-2.5">
        {notices.slice(0, 3).map((notice) => (
          <div key={notice.id} className="grid grid-cols-[52px_minmax(0,1fr)] gap-2.5 text-[13px] leading-5">
            <time className="text-xs tabular-nums text-[var(--cd-color-text-muted)]">{new Date(notice.updated_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time>
            <p className="text-[var(--cd-color-text-secondary)]">{notice.content}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
