'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Library } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { OSSManager } from '@/src/components/OSSManager';

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
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[#eef2f6] text-slate-900">
      <header className="shrink-0 border-b border-slate-200/90 bg-[#f8fafc]/95 backdrop-blur-xl">
        <div className="mx-auto flex min-h-[54px] w-full max-w-[1600px] items-center justify-between gap-3 px-3 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003e7e] text-white shadow-sm"><Library size={15} /></div>
            <h1 className="truncate text-[13px] font-semibold text-slate-900">研究资料库</h1>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {userEmail ? <span className="hidden max-w-64 truncate text-[10px] text-slate-400 lg:inline">当前用户：{userEmail}</span> : null}
            <Link href="/" className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[10px] font-medium text-slate-600 transition hover:border-[#003e7e]/25 hover:text-[#003e7e]"><ArrowLeft size={13} /> 主页</Link>
          </div>
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 overflow-hidden p-3 sm:p-5">
        {!userEmail ? (
          <div className="flex h-full items-center justify-center rounded-lg border border-[#d9e0e8] bg-white shadow-[0_1px_3px_rgba(23,32,51,0.03)]">
            <div className="text-center">
              <div className="mx-auto h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-[#003e7e]" />
              <div className="mt-2 text-[11px] font-medium text-slate-500">正在加载研究资料库…</div>
            </div>
          </div>
        ) : (
          <div className="h-full overflow-hidden rounded-lg border border-[#d9e0e8] bg-white shadow-[0_1px_3px_rgba(23,32,51,0.03)]"><OSSManager userEmail={userEmail} /></div>
        )}
      </main>
    </div>
  );
}
