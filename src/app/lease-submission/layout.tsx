'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

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
  return children;
}
