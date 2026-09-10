'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { ACTION_MODULES } from '@/src/services/MapController';

const BUILDING_COMPARE_ID = 'building-compare';
const BUILDING_COMPARE_LABEL = '楼宇对比';
const NEARBY_COMPARE_HANDLER = '__colliers_analyzeCompetitors';

function getBuildingIdFromInfoWindow(button: HTMLButtonElement): string | null {
  const infoWindow = button.closest('.amap-info-content');
  if (!infoWindow) return null;

  const nearbyCompareButton = infoWindow.querySelector<HTMLButtonElement>(
    `button[onclick*="${NEARBY_COMPARE_HANDLER}"]`,
  );
  const handler = nearbyCompareButton?.getAttribute('onclick') || '';
  const match = handler.match(/__colliers_analyzeCompetitors\('([^']+)'/);
  return match?.[1] || null;
}

export function MapBuildingCompareBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!ACTION_MODULES.some((module) => module.id === BUILDING_COMPARE_ID)) {
      const latestSalesIndex = ACTION_MODULES.findIndex((module) => module.id === 'latest-sales');
      ACTION_MODULES.splice(latestSalesIndex >= 0 ? latestSalesIndex : ACTION_MODULES.length, 0, {
        id: BUILDING_COMPARE_ID,
        label: BUILDING_COMPARE_LABEL,
        icon: '📑',
        enabled: true,
      });
    }

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest('button');
      if (!(button instanceof HTMLButtonElement)) return;
      if (button.textContent?.trim() !== BUILDING_COMPARE_LABEL) return;

      const buildingId = getBuildingIdFromInfoWindow(button);
      if (!buildingId) return;

      event.preventDefault();
      event.stopPropagation();
      router.push(`/compare?buildingId=${encodeURIComponent(buildingId)}`);
    };

    document.addEventListener('click', handleClick, true);

    return () => {
      document.removeEventListener('click', handleClick, true);
      const moduleIndex = ACTION_MODULES.findIndex((module) => module.id === BUILDING_COMPARE_ID);
      if (moduleIndex >= 0) ACTION_MODULES.splice(moduleIndex, 1);
    };
  }, [router]);

  return null;
}
