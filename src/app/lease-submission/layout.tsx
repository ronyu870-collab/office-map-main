'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import { getSessionFast } from '@/src/services/Auth';
import { canAccessModule } from '@/src/utils/accessControl';
import './lease-submission.css';

function LeaseSubmissionGuardLoading() {
  return (
    <div className="lease-submission-shell flex h-screen h-[100dvh] items-center justify-center bg-[#f3f5f7]">
      <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-[#003e7e]" />
    </div>
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
  return <div className="lease-submission-shell">{children}</div>;
}
