'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, LibraryBig } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { OSSManager } from '@/src/components/OSSManager';
import { LoadingState } from '@/src/components/ui/State';

export default function OSSPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = React.useState('');

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
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#f3f5f7] text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-14 w-full max-w-[1500px] flex-wrap items-center gap-3 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[#003e7e]/8 text-[#003e7e]">
              <LibraryBig size={16} />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold tracking-[0.06em] text-zinc-900">研究资料库</h1>
              <p className="mt-0.5 truncate text-[10px] text-zinc-400">检索、浏览和维护内部研究资料</p>
            </div>
          </div>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden max-w-64 truncate text-[10px] text-zinc-400 md:block">当前用户：{userEmail || '正在读取用户身份…'}</span>
            <Link href="/" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2.5 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50">
              <ArrowLeft size={12} />返回工作区
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-[1500px] flex-1 overflow-hidden p-3 sm:p-5">
        {!userEmail ? (
          <div className="h-full rounded-[8px] border border-zinc-200 bg-white p-4 shadow-sm"><LoadingState label="正在加载研究资料库" /></div>
        ) : (
          <div className="h-full overflow-hidden rounded-[8px] border border-zinc-200 bg-white shadow-sm"><OSSManager userEmail={userEmail} /></div>
        )}
      </main>
    </div>
  );
}
