'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

import {
  addProposalCandidate,
  MAX_PROPOSAL_CANDIDATES,
  PROPOSAL_DRAFT_EVENT,
  readProposalDraft,
} from '@/src/lib/intelligence/proposalDraft';

const NEARBY_COMPARE_HANDLER = '__colliers_analyzeCompetitors';
const ACTION_ID = 'proposal-add';

type BuildingContext = { buildingId: string; buildingName?: string };

function readBuildingContext(infoWindow: Element): BuildingContext | null {
  const explicitId = infoWindow.getAttribute('data-building-id')?.trim();
  const explicitName = infoWindow.getAttribute('data-building-name')?.trim();
  if (explicitId) return { buildingId: explicitId, buildingName: explicitName || undefined };

  const nearby = infoWindow.querySelector<HTMLButtonElement>(`button[onclick*="${NEARBY_COMPARE_HANDLER}"]`);
  const handler = nearby?.getAttribute('onclick') || '';
  const idMatch = handler.match(/__colliers_analyzeCompetitors\('([^']+)'/);
  const buildingId = idMatch?.[1]?.trim();
  if (!buildingId) return null;

  const buildingName = Array.from(infoWindow.querySelectorAll<HTMLElement>('[title]'))
    .map(element => element.getAttribute('title')?.trim() || '')
    .find(value => value && !['编辑数据', '删除', '收起筛选面板'].includes(value));
  return { buildingId, buildingName: buildingName || undefined };
}

function proposalButtonState(buildingId: string) {
  const draft = readProposalDraft();
  const selected = Boolean(draft?.items.some(item => item.buildingId === buildingId));
  const full = Boolean(draft && draft.items.length >= MAX_PROPOSAL_CANDIDATES);
  return { selected, full, count: draft?.items.length ?? 0 };
}

function decorateProposalActions(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.amap-info-content, .amap-info-outer').forEach(infoWindow => {
    const context = readBuildingContext(infoWindow);
    if (!context) return;

    infoWindow.setAttribute('data-building-id', context.buildingId);
    if (context.buildingName) infoWindow.setAttribute('data-building-name', context.buildingName);

    let button = infoWindow.querySelector<HTMLButtonElement>(`button[data-map-action="${ACTION_ID}"]`);
    if (!button) {
      const reference = Array.from(infoWindow.querySelectorAll<HTMLButtonElement>('button'))
        .find(item => ['楼宇对比', '周边项目对比'].includes(item.textContent?.trim() || ''));
      const container = reference?.parentElement;
      if (!reference || !container) return;
      button = reference.cloneNode(true) as HTMLButtonElement;
      button.removeAttribute('onclick');
      button.dataset.mapAction = ACTION_ID;
      button.type = 'button';
      container.appendChild(button);
    }

    const state = proposalButtonState(context.buildingId);
    button.disabled = state.selected || state.full;
    button.textContent = state.selected
      ? '✓ 已加入方案'
      : state.full
        ? `方案已满 ${state.count}/${MAX_PROPOSAL_CANDIDATES}`
        : '＋ 加入客户方案';
    button.setAttribute('aria-label', state.selected ? '已加入客户方案' : '加入客户方案');
    button.style.opacity = button.disabled ? '0.58' : '1';
    button.style.cursor = button.disabled ? 'default' : 'pointer';
  });
}

export function MapProposalBridge({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    router.prefetch('/intelligence/proposal');

    const decorateAll = () => decorateProposalActions(document);
    decorateAll();

    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches('.amap-info-content, .amap-info-outer') || node.querySelector('.amap-info-content, .amap-info-outer')) {
            decorateProposalActions(node.parentNode || document);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(`button[data-map-action="${ACTION_ID}"]`);
      if (!button || button.disabled) return;
      event.preventDefault();
      event.stopPropagation();
      const infoWindow = button.closest('.amap-info-content, .amap-info-outer');
      if (!infoWindow) return;
      const context = readBuildingContext(infoWindow);
      if (!context) return;

      const result = addProposalCandidate(context.buildingId, context.buildingName || '未命名楼宇');
      if (result.status === 'full') window.alert(`客户方案最多选择 ${MAX_PROPOSAL_CANDIDATES} 个项目。`);
      if (result.status === 'unavailable') window.alert('客户方案草稿已失效，请返回 Intelligence 重新确认客户需求。');
      decorateAll();
    };

    document.addEventListener('click', handleClick, true);
    window.addEventListener(PROPOSAL_DRAFT_EVENT, decorateAll);
    return () => {
      observer.disconnect();
      document.removeEventListener('click', handleClick, true);
      window.removeEventListener(PROPOSAL_DRAFT_EVENT, decorateAll);
    };
  }, [enabled, router]);

  return null;
}
