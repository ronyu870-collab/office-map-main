'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useAppSession } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { withImpersonationHeaders } from '@/src/services/impersonationHeaders';
import { canReadQuarterlyResearch, isResearchEdition, type ResearchEdition } from '@/src/config/quarterlyResearch';
import styles from './research.module.css';

export function QuarterlyResearch() {
  const { session, status } = useAppSession();
  const { isImpersonating } = useImpersonation();
  const allowed = status === 'authenticated' && canReadQuarterlyResearch(session?.role, isImpersonating)
    && !session?.user.app_metadata?.must_change_password;
  const token = allowed ? session?.session.access_token : undefined;
  const [edition, setEdition] = useState<ResearchEdition>('2026Q3');
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<{ html: string; owner: string; edition: ResearchEdition } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  const owner = `${session?.user.id || ''}:${token || ''}`;
  const requestKey = `${owner}:${edition}:${attempt}`;
  const error = failure?.key === requestKey ? failure.message : '';
  const available = allowed && frame?.owner === owner && frame.edition === edition;

  useEffect(() => {
    if (!allowed || !token) return;
    const controller = new AbortController();
    let stopped = false;
    const headers = withImpersonationHeaders({ Authorization: `Bearer ${token}` });
    const endpoint = `/api/quarterly-research?edition=${edition}`;
    const clear = () => {
      stopped = true;
      controller.abort();
      setFrame(null);
    };
    async function load() {
      try {
        const response = await fetch(endpoint, { headers, signal: controller.signal, cache: 'no-store' });
        if (!response.ok) throw new Error(response.status === 403 ? '此报告仅限管理员访问。' : '报告暂时无法加载，请重试。');
        const html = await response.text();
        if (stopped) return;
        setFrame({ html, owner, edition });
      } catch (cause) {
        if (!stopped) setFailure({ key: requestKey, message: cause instanceof Error ? cause.message : '加载失败，请重试。' });
      }
    }
    async function revalidate() {
      if (stopped || document.visibilityState === 'hidden') return;
      try {
        const response = await fetch(endpoint, { method: 'HEAD', headers, signal: controller.signal, cache: 'no-store' });
        if (!response.ok) { clear(); setFailure({ key: requestKey, message: '访问状态已变化，请重新登录或重试。' }); }
      } catch { if (!stopped) { clear(); setFailure({ key: requestKey, message: '暂时无法验证访问权限，请重试。' }); } }
    }
    void load();
    const interval = window.setInterval(() => { void revalidate(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void revalidate(); };
    const onPageHide = () => clear();
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) setAttempt(value => value + 1); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      clear(); window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [allowed, token, owner, edition, attempt, requestKey]);

  useEffect(() => {
    const message = (event: MessageEvent) => {
      if (!allowed || event.source !== iframe.current?.contentWindow) return;
      if (event.data?.type === 'research-edition' && isResearchEdition(event.data.edition)) setEdition(event.data.edition);
      if (event.data?.type === 'research-home') window.location.assign('/');
    };
    window.addEventListener('message', message);
    return () => window.removeEventListener('message', message);
  }, [allowed]);

  if (!allowed) return <main className={styles.status}><h1>季度研究</h1><p>{status === 'loading' ? '正在确认登录状态…' : '此报告仅限管理员访问。'}</p><Link href={status === 'unauthenticated' ? '/login' : '/'}>{status === 'unauthenticated' ? '前往登录' : '返回首页'}</Link></main>;
  return <main className={styles.host}>
    {available ? <iframe ref={iframe} className={styles.frame} title={`${edition} 北京写字楼交互研究`} srcDoc={frame.html} sandbox="allow-scripts allow-same-origin" />
      : <div className={styles.status}><h1>季度研究</h1><p role="status">{error || '正在载入报告…'}</p>{error && <button onClick={() => setAttempt(value => value + 1)}>重新加载</button>}<Link href="/">返回首页</Link></div>}
  </main>;
}
