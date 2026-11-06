'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { BUILDING_POPUP, readBuildingPopupContext } from '@/src/services/map/buildingPopup';

import {
  addProposalCandidate,
  MAX_PROPOSAL_CANDIDATES,
  PROPOSAL_DRAFT_EVENT,
  readProposalDraft,
} from '@/src/lib/intelligence/proposalDraft';

const ACTION_ID = 'proposal-add';

function proposalButtonState(buildingId: string) {
  const draft = readProposalDraft();
  const selected = Boolean(draft?.items.some(item => item.buildingId === buildingId));
  const full = Boolean(draft && draft.items.length >= MAX_PROPOSAL_CANDIDATES);
  return { selected, full, count: draft?.items.length ?? 0 };
}

function decorateProposalActions(root: ParentNode) {
  const windows = [...root.querySelectorAll<HTMLElement>(BUILDING_POPUP)];
  if (root instanceof HTMLElement && root.matches(BUILDING_POPUP)) windows.unshift(root);
  for (const popup of windows) {
    const context = readBuildingPopupContext(popup);
    const slot = popup.querySelector<HTMLElement>('[data-map-proposal-slot]');
    if (!context || !slot) continue;

    let button = slot.querySelector<HTMLButtonElement>('button');
    if (!button) {
      button = document.createElement('button');
      button.className = 'building-popup__action';
      button.dataset.mapAction = ACTION_ID;
      button.type = 'button';
      slot.append(button);
    }

    const state = proposalButtonState(context.buildingId);
    button.disabled = state.selected || state.full;
    button.textContent = state.selected
      ? '✓ 已加入方案'
      : state.full
        ? `方案已满 ${state.count}/${MAX_PROPOSAL_CANDIDATES}`
        : '＋ 加入客户方案';
    button.setAttribute('aria-label', state.selected ? '已加入客户方案' : state.full ? button.textContent : '加入客户方案');
    slot.hidden = false;
  }
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
          if (node.matches(BUILDING_POPUP) || node.querySelector(BUILDING_POPUP)) decorateProposalActions(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const handleClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>(`button[data-map-action="${ACTION_ID}"]`);
      if (!button || button.disabled) return;
      const context = readBuildingPopupContext(button);
      if (!context) return;
      event.preventDefault();
      event.stopPropagation();

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
