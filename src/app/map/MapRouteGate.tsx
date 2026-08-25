'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { useAppSession } from '@/src/components/SessionProvider';

const MapClient = dynamic(() => import('./MapClient').then(module => module.default), {
  ssr: false,
});

function MapAuthLoading() {
  return (
    <div className="flex h-screen h-[100dvh] flex-col overflow-hidden bg-[#e8edf3] text-slate-900">
      <header className="flex h-[58px] shrink-0 items-center border-b border-slate-200/90 bg-[#f8fafc]/95 px-3 shadow-sm sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#003e7e] text-[10px] font-bold tracking-wide text-white shadow-sm">CD</div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold tracking-[0.08em] text-slate-900">COLLIERS DATA</div>
            <div className="truncate text-[10px] text-slate-400">北京办公楼市场地图</div>
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
      </div>
    </div>
  );
}

export function MapRouteGate() {
  const router = useRouter();
  const { status } = useAppSession();

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  // Preserve the P0 security contract: MapClient, AMap and map data requests are
  // never mounted until the shared root session has resolved as authenticated.
  if (status !== 'authenticated') return <MapAuthLoading />;

  return <MapClient />;
}
