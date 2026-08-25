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
    <div className="flex h-screen h-[100dvh] items-center justify-center bg-gray-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#003e7e] border-t-transparent" />
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
