'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import { getSessionFast } from '@/src/services/Auth';
import { OSSManager } from '@/src/components/OSSManager';

export default function OSSPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = React.useState('');
  const isLoadingUser = !userEmail;

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const session = await getSessionFast();
        if (cancelled) return;
        if (!session) {
          router.replace('/login');
          return;
        }
        setUserEmail(session.user.email ?? '未知用户');
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-zinc-50 text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200/80 bg-[#003e7e]">
        <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold tracking-tight text-white">云端资料库</span>
            <span className="hidden rounded border border-white/20 px-1.5 py-0.5 text-[10px] font-medium text-white/60 sm:inline">OSS File Manager</span>
          </div>
          <Link href="/" className="flex items-center gap-1.5 text-[12px] text-white/70 transition hover:text-white">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
            返回主页
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1200px] flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        {isLoadingUser ? (
          <div className="space-y-4">
            <div className="h-12 w-64 animate-pulse rounded-lg bg-zinc-200" />
            <div className="h-96 animate-pulse rounded-xl bg-zinc-200" />
          </div>
        ) : (
          <OSSManager userEmail={userEmail} />
        )}
      </main>
    </div>
  );
}
