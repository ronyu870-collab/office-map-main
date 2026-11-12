'use client';

import { BrokerSearchLink } from '@/src/components/BrokerSearchLink';
import * as React from 'react';
import { useRouter } from 'next/navigation';

import { useAppSession } from '@/src/components/SessionProvider';
import { OSSManager } from '@/src/components/OSSManager';
import { AppHeader, LoadingState } from '@/src/components/ui';

export default function OSSPage() {
  const router = useRouter();
  const { session, status } = useAppSession();
  const userEmail = status === 'authenticated' && session
    ? (session.user.email ?? '未知用户')
    : '';

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--cd-color-canvas)] text-[var(--cd-color-text-primary)]">
      <header className="shrink-0 border-b border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <div className="mx-auto w-full max-w-[1600px]">
          <AppHeader leading={<BrokerSearchLink />} title="研究资料库" homeHref="/" />
        </div>
      </header>

      <main className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 overflow-hidden p-3 sm:p-4">
        {!userEmail ? (
          <div className="flex h-full items-center justify-center rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
            <LoadingState label="正在加载研究资料库" rows={0} />
          </div>
        ) : (
          <div className="h-full overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]"><OSSManager userEmail={userEmail} /></div>
        )}
      </main>
    </div>
  );
}