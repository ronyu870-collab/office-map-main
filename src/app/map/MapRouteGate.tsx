'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';

import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import { useAppSession } from '@/src/components/SessionProvider';
import type { IntelligenceMapRouteState } from './model/intelligenceMapHandoff';
import { MapLoadingShell } from './components/MapLoadingShell';

export type BuildingFocus = { id: string; future: boolean; section?: 'brochure' | 'availability' | 'deals'; back?: string };

const MapClient = dynamic(() => import('./MapClient').then(module => module.default), {
  ssr: false,
});

export function MapRouteGate({
  initialIntelligenceHandoff = null,
  buildingFocus,
}: {
  buildingFocus?: BuildingFocus | null;
  initialIntelligenceHandoff?: IntelligenceMapRouteState | null;
}) {
  const router = useRouter();
  const { session, status } = useAppSession();
  const { targetUserId } = useImpersonation();

  React.useEffect(() => {
    if (status === 'unauthenticated') router.replace('/login');
  }, [router, status]);

  // Preserve the P0 security contract: MapClient, AMap and map data requests are
  // never mounted until the shared root session has resolved as authenticated.
  if (status !== 'authenticated') return <MapLoadingShell />;

  return <MapClient key={JSON.stringify([session?.user.id, session?.role, targetUserId])} initialIntelligenceHandoff={initialIntelligenceHandoff} buildingFocus={buildingFocus} />;
}
