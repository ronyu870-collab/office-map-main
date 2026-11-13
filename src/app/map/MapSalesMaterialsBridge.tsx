'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { SalesMaterialReader } from '@/src/services/salesMaterialsClient';

// Keep the viewer and data client out of the map startup path.
const SalesMaterialsPanel = dynamic(() => import('./components/sales-materials/SalesMaterialsPanel'));

type Context = { buildingId: string; buildingName: string; initialCategory?: 'brochure' | 'availability' };

export function MapSalesMaterialsBridge({ reader }: { reader?: SalesMaterialReader } = {}) {
  const [context, setContext] = useState<Context | null>(null);
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-map-action="building-sales-control"]');
      if (!button?.dataset.buildingId) return;
      event.preventDefault();
      event.stopPropagation();
      const initialCategory = button.dataset.category;
      setContext({ buildingId: button.dataset.buildingId, buildingName: button.dataset.buildingName || '当前楼宇',
        initialCategory: initialCategory === 'brochure' || initialCategory === 'availability' ? initialCategory : undefined });

    };
    const onSection = (event: Event) => {
      const { id, name, section } = (event as CustomEvent).detail;
      if (section === 'brochure' || section === 'availability') setContext({ buildingId: id, buildingName: name, initialCategory: section });
    };
    document.addEventListener('click', onClick, true);
    window.addEventListener('broker:building-section', onSection);
    return () => {
      document.removeEventListener('click', onClick, true);
      window.removeEventListener('broker:building-section', onSection);
    };
  }, []);
  return context ? <SalesMaterialsPanel key={`${context.buildingId}:${context.initialCategory ?? ""}`} {...context} reader={reader} onClose={() => setContext(null)} /> : null;
}
