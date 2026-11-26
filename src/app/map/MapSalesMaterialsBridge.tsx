'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useAppSession } from '@/src/components/SessionProvider';
import { useImpersonation } from '@/src/contexts/ImpersonationContext';
import type { SalesMaterialReader } from '@/src/services/salesMaterialsClient';

// Keep the viewer and data client out of the map startup path.
const SalesMaterialsPanel = dynamic(() => import('./components/sales-materials/SalesMaterialsPanel'));

type Context = { scope: string; buildingId: string; buildingName: string; initialCategory?: 'brochure' | 'availability' };

export function MapSalesMaterialsBridge({ reader }: { reader?: SalesMaterialReader } = {}) {
  const {session,status}=useAppSession();
  const {targetUserId,targetRole}=useImpersonation();
  const scope=JSON.stringify([status,session?.user.id,session?.role,session?.sessionId,targetUserId,targetRole]);
  const [context, setContext] = useState<Context | null>(null);
  useEffect(()=>{setContext(null);},[scope]);
  const active=context?.scope===scope&&status==='authenticated'?context:null;
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-map-action="building-sales-control"]');
      if (!button?.dataset.buildingId || status!=='authenticated') return;
      event.preventDefault();
      event.stopPropagation();
      const initialCategory = button.dataset.category;
      setContext({ scope, buildingId: button.dataset.buildingId, buildingName: button.dataset.buildingName || '当前楼宇',
        initialCategory: initialCategory === 'brochure' || initialCategory === 'availability' ? initialCategory : undefined });

    };
    const onSection = (event: Event) => {
      const { id, name, section } = (event as CustomEvent).detail;
      if (status==='authenticated' && (section === 'brochure' || section === 'availability')) setContext({ scope, buildingId: id, buildingName: name, initialCategory: section });
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('broker:building-section', onSection);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('broker:building-section', onSection);
    };
  }, [scope,status]);
  return active ? <SalesMaterialsPanel key={`${active.scope}:${active.buildingId}:${active.initialCategory ?? ""}`} buildingId={active.buildingId} buildingName={active.buildingName} initialCategory={active.initialCategory} reader={reader} onClose={() => setContext(null)} /> : null;
}
