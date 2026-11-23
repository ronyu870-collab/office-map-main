'use client';

import { useEffect, useRef } from 'react';
import { currentMapReturnHref } from './workspace/continuity';
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
    let navigationTimer: number | undefined;

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

      const params = new URLSearchParams({ buildingId: detail.buildingId, back: currentMapReturnHref(detail.buildingId) });
      if (detail.buildingName) params.set('name', detail.buildingName);
      navigatingRef.current = true;
      router.push(`/compare?${params.toString()}`);
      navigationTimer = window.setTimeout(() => { navigatingRef.current = false; navigationTimer = undefined; }, 1000);
    };

    document.addEventListener('click', handleDelegatedClick, true);
    window.addEventListener(REQUEST_EVENT, handleRequest);

    return () => {
      window.clearTimeout(navigationTimer);
      navigatingRef.current = false;
      document.removeEventListener('click', handleDelegatedClick, true);
      window.removeEventListener(REQUEST_EVENT, handleRequest);
    };
  }, [router]);

  return null;
}
