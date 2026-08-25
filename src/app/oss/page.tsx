'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

import { getSessionFast } from '@/src/services/Auth';
import { OSSManager } from '@/src/components/OSSManager';
import { PageHeader } from '@/src/components/ui/PageHeader';
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
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--cd-color-canvas)] text-[var(--cd-color-text-primary)]">
      <div className="shrink-0 bg-white px-3 pt-4 sm:px-5">
        <PageHeader
          eyebrow="资料检索"
          title="研究资料库"
          description="搜索、定位、打开和下载内部研究资料。管理权限用户可维护目录与文件。"
          meta={userEmail ? `当前用户：${userEmail}` : '正在读取用户身份…'}
          actions={
            <Link href="/" className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50">
              <ArrowLeft size={14} />返回工作区
            </Link>
          }
        />
      </div>
      <main className="min-h-0 flex-1 overflow-hidden px-3 pb-3 pt-3 sm:px-5 sm:pb-5">
        {!userEmail ? (
          <div className="h-full rounded-lg border border-zinc-200 bg-white p-4"><LoadingState label="正在加载研究资料库" /></div>
        ) : (
          <div className="h-full overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-sm"><OSSManager userEmail={userEmail} /></div>
        )}
      </main>
    </div>
  );
}
