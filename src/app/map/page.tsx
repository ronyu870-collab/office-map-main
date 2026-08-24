'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { getSessionFast } from '@/src/services/Auth';

const MapClient = dynamic(() => import('./MapClient').then(m => m.default), {
  ssr: false,
});

function MapAuthLoading() {
  return (
    <div className="flex h-screen h-[100dvh] items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
    </div>
  );
}

export default function MapPage() {
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
        setAuthorized(true);
      } catch {
        if (!cancelled) router.replace('/login');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [router]);

  // MapClient (and therefore AMap + Supabase map queries) is not mounted before auth succeeds.
  if (!authorized) return <MapAuthLoading />;

  return <MapClient />;
}
