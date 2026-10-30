'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SalesMaterialReader } from '@/src/services/salesMaterialsClient';

// Keep the viewer and data client out of the map startup path.
const SalesMaterialsPanel = dynamic(() => import('./components/sales-materials/SalesMaterialsPanel'));

type Context = { buildingId: string; buildingName: string };

export function MapSalesMaterialsBridge({ reader }: { reader?: SalesMaterialReader } = {}) {
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-map-action="building-sales-control"]');
      if (!button?.dataset.buildingId) return;
      event.preventDefault();
      event.stopPropagation();
      setContext({ buildingId: button.dataset.buildingId, buildingName: button.dataset.buildingName || '当前楼宇' });
    };
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, []);
  return context ? <SalesMaterialsPanel key={context.buildingId} {...context} reader={reader} onClose={() => setContext(null)} /> : null;
}
