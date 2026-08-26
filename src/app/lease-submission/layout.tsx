'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';

import './concise.css';
import { getSessionFast } from '@/src/services/Auth';
import { canAccessModule } from '@/src/utils/accessControl';

function LeaseSubmissionGuardLoading() {
  return (
    <div className="flex h-screen h-[100dvh] items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
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
  return children;
}