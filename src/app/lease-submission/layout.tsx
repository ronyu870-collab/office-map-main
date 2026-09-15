'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

import { getSessionFast } from '@/src/services/Auth';
import { canAccessModule } from '@/src/utils/accessControl';
import { LoadingState } from '@/src/components/ui';

function LeaseSubmissionGuardLoading() {
  return (
    <div className="flex h-screen h-[100dvh] items-center justify-center bg-[var(--cd-color-workspace)] px-6"><LoadingState label="正在校验租赁成交填报权限" rows={0} /></div>
  );
}

export default function LeaseSubmissionLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [authorized, setAuthorized] = React.useState(false);

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

        if (!canAccessModule('lease-submission', session.role)) {
          router.replace('/');
          return;
        }

        setAuthorized(true);
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!authorized) return <LeaseSubmissionGuardLoading />;

  const inDatabase = pathname?.startsWith('/lease-submission/history');
  return (
    <>
      {children}
      <Link
        href={inDatabase ? '/lease-submission' : '/lease-submission/history'}
        className="fixed bottom-5 right-5 z-[var(--cd-z-sticky)] rounded-full border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-4 py-2 text-xs font-semibold text-[var(--cd-color-brand)] shadow-lg transition hover:-translate-y-0.5 hover:shadow-xl"
      >
        {inDatabase ? '返回成交填报' : '成交数据库'}
      </Link>
    </>
  );
}
