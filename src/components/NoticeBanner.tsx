'use client';

import * as React from 'react';
import { getAllActiveNotices } from '@/src/services/apiClient';
import type { NoticeRow } from '@/src/services/apiClient';
import styles from './NoticeBanner.module.css';

const BEIJING_TIME_ZONE = 'Asia/Shanghai';

function formatNoticeDate(value: string) {
  const date = new Date(value);
  const now = new Date();
  const yearFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: BEIJING_TIME_ZONE,
    year: 'numeric',
  });
  const includeYear = yearFormatter.format(date) !== yearFormatter.format(now);

  return date.toLocaleDateString('zh-CN', {
    timeZone: BEIJING_TIME_ZONE,
    ...(includeYear ? { year: 'numeric' as const } : {}),
    month: 'numeric',
    day: 'numeric',
  });
}

export function NoticeBanner() {
  const [notices, setNotices] = React.useState<NoticeRow[] | null>(null);
  const [loadError, setLoadError] = React.useState(false);
  const [visible, setVisible] = React.useState(false);
  const [expanded, setExpanded] = React.useState(false);
  const [requestKey, setRequestKey] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    const request = new AbortController();
    let visibleFrameId: number | null = null;
    const timeoutId = setTimeout(() => {
      if (!active) return;
      request.abort();
      setLoadError(true);
      setNotices([]);
    }, 3000);

    getAllActiveNotices(request.signal)
      .then((data) => {
        if (!active || request.signal.aborted) return;
        clearTimeout(timeoutId);
        setLoadError(false);
        setNotices(data);
        setExpanded(false);
        if (data.length > 0) {
          visibleFrameId = requestAnimationFrame(() => {
            visibleFrameId = null;
            if (active) setVisible(true);
          });
        }
      })
      .catch(() => {
        if (!active || request.signal.aborted) return;
        clearTimeout(timeoutId);
        setLoadError(true);
        setNotices([]);
      });

    return () => {
      active = false;
      request.abort();
      clearTimeout(timeoutId);
      if (visibleFrameId !== null) cancelAnimationFrame(visibleFrameId);
    };
  }, [requestKey]);

  const retry = () => {
    setVisible(false);
    setLoadError(false);
    setNotices(null);
    setRequestKey((value) => value + 1);
  };

  if (notices === null) {
    return <div className="h-12 animate-pulse border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface-alt)]" aria-hidden="true" />;
  }

  if (loadError) {
    return (
      <section className="bg-transparent py-2" aria-label="系统公告加载失败">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-[var(--cd-color-text-primary)]">系统公告</div>
            <p className="mt-1 text-sm text-[var(--cd-color-text-secondary)]">公告暂时无法加载</p>
          </div>
          <button
            type="button"
            onClick={retry}
            className="min-h-9 rounded-[var(--cd-radius-sm)] px-2.5 text-sm font-medium text-[var(--cd-color-brand)] hover:bg-[var(--cd-color-brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25"
          >
            重试
          </button>
        </div>
      </section>
    );
  }

  if (notices.length === 0) return null;

  const visibleNotices = expanded ? notices : notices.slice(0, 3);

  return (
    <section className={`${styles.notices} bg-transparent transition-opacity duration-300 motion-reduce:transition-none ${visible ? 'opacity-100' : 'opacity-0'}`} aria-live="polite" aria-label="系统公告">
      <div className={styles.heading}>系统公告</div>
      <div className={styles.list}>
        {visibleNotices.map((notice) => (
          <div key={notice.id} className={styles.row}>
            <time dateTime={notice.updated_at} className="whitespace-nowrap text-sm tabular-nums text-[var(--cd-color-text-secondary)]">{formatNoticeDate(notice.updated_at)}</time>
            <p className="break-words text-[var(--cd-color-text-secondary)] [overflow-wrap:anywhere]">{notice.content}</p>
          </div>
        ))}
      </div>

      {notices.length > 3 ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className={`${styles.expand} rounded-[var(--cd-radius-sm)] text-sm font-medium text-[var(--cd-color-brand)] hover:bg-[var(--cd-color-brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cd-color-brand)]/25`}
          aria-expanded={expanded}
        >
          {expanded ? '收起公告' : `查看全部 ${notices.length} 条公告`}
        </button>
      ) : null}
    </section>
  );
}
