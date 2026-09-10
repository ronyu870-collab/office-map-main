'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';

import { ACTION_MODULES } from '@/src/services/MapController';

const BUILDING_COMPARE_ID = 'building-compare';
const BUILDING_COMPARE_LABEL = '楼宇对比';
const NEARBY_COMPARE_HANDLER = '__colliers_analyzeCompetitors';
const REQUEST_EVENT = 'map-building-compare-request';

type CompareRequestDetail = { buildingId: string; buildingName?: string };

function getInfoWindow(element: Element): Element | null {
  return element.closest('.amap-info-content') || element.closest('.amap-info-outer');
}

function readBuildingContext(infoWindow: Element): CompareRequestDetail | null {
  const nearby = infoWindow.querySelector<HTMLButtonElement>(
    `button[onclick*="${NEARBY_COMPARE_HANDLER}"]`,
  );
  const handler = nearby?.getAttribute('onclick') || '';
  const idMatch = handler.match(/__colliers_analyzeCompetitors\('([^']+)'/);
  const buildingId = idMatch?.[1]?.trim();
  if (!buildingId) return null;

  const buildingName = Array.from(infoWindow.querySelectorAll<HTMLElement>('[title]'))
    .map(element => element.getAttribute('title')?.trim() || '')
    .find(value => value && value !== '编辑数据' && value !== '删除' && value !== '收起筛选面板');

  return { buildingId, buildingName: buildingName || undefined };
}

function decorateInfoWindow(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('.amap-info-content, .amap-info-outer').forEach(infoWindow => {
    const context = readBuildingContext(infoWindow);
    if (context) {
      infoWindow.setAttribute('data-building-id', context.buildingId);
      if (context.buildingName) infoWindow.setAttribute('data-building-name', context.buildingName);
    }

    infoWindow.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      const label = button.textContent?.trim() || '';
      if (label === BUILDING_COMPARE_LABEL) {
        button.dataset.mapAction = BUILDING_COMPARE_ID;
        button.type = 'button';
        button.setAttribute('aria-label', context?.buildingName ? `对比${context.buildingName}` : BUILDING_COMPARE_LABEL);
      } else if (button.getAttribute('onclick')?.includes(NEARBY_COMPARE_HANDLER)) {
        button.dataset.mapAction = 'nearby-compare';
      } else if (label === '趋势追踪') {
        button.dataset.mapAction = 'trend';
      } else if (label === '联系方式') {
        button.dataset.mapAction = 'contact';
      }
    });
  });
}

export function MapBuildingCompareBridge() {
  const router = useRouter();
  const navigatingRef = useRef(false);

  useEffect(() => {
    router.prefetch('/compare');

    if (!ACTION_MODULES.some(module => module.id === BUILDING_COMPARE_ID)) {
      const latestSalesIndex = ACTION_MODULES.findIndex(module => module.id === 'latest-sales');
      ACTION_MODULES.splice(latestSalesIndex >= 0 ? latestSalesIndex : ACTION_MODULES.length, 0, {
        id: BUILDING_COMPARE_ID,
        label: BUILDING_COMPARE_LABEL,
        icon: '📑',
        enabled: true,
      });
    }

    decorateInfoWindow(document);
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) {
            if (node.matches('.amap-info-content, .amap-info-outer')) decorateInfoWindow(node.parentNode || document);
            else if (node.querySelector('.amap-info-content, .amap-info-outer')) decorateInfoWindow(node);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleDelegatedClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>('button[data-map-action="building-compare"]');
      if (!button) return;

      event.preventDefault();
      event.stopPropagation();
      const infoWindow = getInfoWindow(button);
      if (!infoWindow) return;

      const buildingId = infoWindow.getAttribute('data-building-id') || readBuildingContext(infoWindow)?.buildingId;
      const buildingName = infoWindow.getAttribute('data-building-name') || readBuildingContext(infoWindow)?.buildingName;
      if (!buildingId) {
        console.warn('[MapBuildingCompareBridge] Missing building id for comparison navigation.');
        return;
      }

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
      observer.disconnect();
      document.removeEventListener('click', handleDelegatedClick, true);
      window.removeEventListener(REQUEST_EVENT, handleRequest);
      const moduleIndex = ACTION_MODULES.findIndex(module => module.id === BUILDING_COMPARE_ID);
      if (moduleIndex >= 0) ACTION_MODULES.splice(moduleIndex, 1);
    };
  }, [router]);

  return null;
}
