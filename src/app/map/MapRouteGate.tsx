'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { useAppSession } from '@/src/components/SessionProvider';
import type { IntelligenceMapRouteState } from './model/intelligenceMapHandoff';
import { MapLoadingShell } from './components/MapLoadingShell';

const MapClient = dynamic(() => import('./MapClient').then(module => module.default), {
  ssr: false,
});

export function MapRouteGate({
  initialIntelligenceHandoff,
}: {
  initialIntelligenceHandoff: IntelligenceMapRouteState | null;
}) {
  const router = useRouter();
  const { status } = useAppSession();

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  // Preserve the P0 security contract: MapClient, AMap and map data requests are
  // never mounted until the shared root session has resolved as authenticated.
  if (status !== 'authenticated') return <MapLoadingShell />;

  return <MapClient initialIntelligenceHandoff={initialIntelligenceHandoff} />;
}
