'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { readBuildingPopupContext } from '@/src/services/map/buildingPopup';

const BUILDING_COMPARE_ID = 'building-compare';
const REQUEST_EVENT = 'map-building-compare-request';

type CompareRequestDetail = { buildingId: string; buildingName?: string };

export function MapBuildingCompareBridge() {
  const router = useRouter();
  const navigatingRef = useRef(false);

  useEffect(() => {
    router.prefetch('/compare');

    const handleDelegatedClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-map-action="building-compare"]');
      if (!button) return;

      const context = readBuildingPopupContext(button);
      if (!context) return;
      event.preventDefault();
      event.stopPropagation();
      const { buildingId, buildingName } = context;

      window.dispatchEvent(new CustomEvent<CompareRequestDetail>(REQUEST_EVENT, {
        detail: { buildingId, buildingName: buildingName || undefined },
      }));
    };

    const handleRequest = (event: Event) => {
      const detail = (event as CustomEvent<CompareRequestDetail>).detail;
      if (!detail?.buildingId || navigatingRef.current) return;

      const params = new URLSearchParams({ buildingId: detail.buildingId });
      if (detail.buildingName) params.set('name', detail.buildingName);
      navigatingRef.current = true;
      router.push(`/compare?${params.toString()}`);
      window.setTimeout(() => { navigatingRef.current = false; }, 1000);
    };

    document.addEventListener('click', handleDelegatedClick, true);
    window.addEventListener(REQUEST_EVENT, handleRequest);

    return () => {
      document.removeEventListener('click', handleDelegatedClick, true);
      window.removeEventListener(REQUEST_EVENT, handleRequest);
    };
  }, [router]);

  return null;
}
