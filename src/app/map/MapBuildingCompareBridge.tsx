'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { ACTION_MODULES } from '@/src/services/MapController';

const BUILDING_COMPARE_ID = 'building-compare';
const BUILDING_COMPARE_LABEL = '楼宇对比';
const NEARBY_COMPARE_HANDLER = '__colliers_analyzeCompetitors';

function getInfoWindow(button: HTMLButtonElement): Element | null {
  return button.closest('.amap-info-content') || button.closest('.amap-info-outer');
}

function getBuildingIdFromInfoWindow(button: HTMLButtonElement): string | null {
  const infoWindow = getInfoWindow(button);
  if (!infoWindow) return null;

  const nearbyCompareButton = infoWindow.querySelector<HTMLButtonElement>(
    `button[onclick*="${NEARBY_COMPARE_HANDLER}"]`,
  );
  const handler = nearbyCompareButton?.getAttribute('onclick') || '';
  const match = handler.match(/__colliers_analyzeCompetitors\('([^']+)'/);
  return match?.[1]?.trim() || null;
}

function getBuildingNameFromInfoWindow(button: HTMLButtonElement): string | null {
  const infoWindow = getInfoWindow(button);
  if (!infoWindow) return null;

  const titledElements = Array.from(infoWindow.querySelectorAll<HTMLElement>('[title]'));
  const title = titledElements
    .map(element => element.getAttribute('title')?.trim() || '')
    .find(value => value && value !== '编辑数据' && value !== '删除' && value !== '收起筛选面板');

  return title || null;
}

export function MapBuildingCompareBridge() {
  const router = useRouter();
  const navigatingRef = useRef(false);

  useEffect(() => {
    router.prefetch('/compare');

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

      event.preventDefault();
      event.stopPropagation();

      if (navigatingRef.current) return;

      const buildingId = getBuildingIdFromInfoWindow(button);
      if (!buildingId) {
        console.warn('[MapBuildingCompareBridge] Missing building id for comparison navigation.');
        return;
      }

      const params = new URLSearchParams({ buildingId });
      const buildingName = getBuildingNameFromInfoWindow(button);
      if (buildingName) params.set('name', buildingName);

      navigatingRef.current = true;
      router.push(`/compare?${params.toString()}`);

      // Keep the guard short so a failed/cancelled client navigation does not permanently disable the action.
      window.setTimeout(() => {
        navigatingRef.current = false;
      }, 1200);
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
