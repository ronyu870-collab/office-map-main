'use client';

import { useEffect } from 'react';

import { getSessionFast } from '@/src/services/Auth';

const NEARBY_COMPARE_HANDLER = '__colliers_analyzeCompetitors';
const PANEL_ATTR = 'data-lease-read-panel';
const cache = new Map<string, { count: number; records: LeaseRow[] }>();

type LeaseRow = {
  read_id: string;
  record_source: 'live' | 'history';
  company: string | null;
  area_sqm: number | null;
  face_rent: number | null;
  transaction_year: number | null;
  transaction_quarter: string | null;
};

function readBuildingId(infoWindow: Element): string | null {
  const explicit = infoWindow.getAttribute('data-building-id')?.trim();
  if (explicit) return explicit;
  const button = infoWindow.querySelector<HTMLButtonElement>(`button[onclick*="${NEARBY_COMPARE_HANDLER}"]`);
  const handler = button?.getAttribute('onclick') || '';
  return handler.match(/__colliers_analyzeCompetitors\('([^']+)'/)?.[1]?.trim() || null;
}

function fmt(value: number | null) {
  return value == null ? '-' : value.toLocaleString('zh-CN', { maximumFractionDigits: 1 });
}

function renderPanel(panel: HTMLElement, payload: { count: number; records: LeaseRow[] }) {
  const rows = payload.records.slice(0, 5).map(row => `
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 60px 56px;gap:8px;align-items:center;padding:6px 0;border-top:1px solid #edf0f3;font-size:11px;">
      <div style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#172033;font-weight:500;" title="${escapeHtml(row.company || '-')}">${escapeHtml(row.company || '-')}</div>
      <div style="text-align:right;color:#566174;font-variant-numeric:tabular-nums;">${escapeHtml(fmt(row.area_sqm))}㎡</div>
      <div style="text-align:right;color:#566174;font-variant-numeric:tabular-nums;">${escapeHtml(`${row.transaction_year ?? '-'}${row.transaction_quarter ?? ''}`)}</div>
    </div>
  `).join('');

  panel.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:4px;">
      <div style="font-size:11px;font-weight:700;color:#172033;">租赁成交</div>
      <div style="font-size:10px;color:#7b8494;">${payload.count.toLocaleString('zh-CN')} 条 · 实时+历史</div>
    </div>
    ${rows || '<div style="padding:8px 0;font-size:11px;color:#8a94a3;">暂无已关联成交</div>'}
  `;
}

function escapeHtml(input: string) {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function loadBuildingLeases(buildingId: string) {
  const cached = cache.get(buildingId);
  if (cached) return cached;
  const session = await getSessionFast();
  const token = session?.session?.access_token;
  if (!token) throw new Error('unauthorized');
  const params = new URLSearchParams({ building_id: buildingId, limit: '5' });
  const response = await fetch(`/api/lease-transactions/read?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('lease-read-failed');
  const body = await response.json();
  const payload = { count: Number(body.count ?? 0), records: (body.records ?? []) as LeaseRow[] };
  cache.set(buildingId, payload);
  return payload;
}

function ensurePanel(infoWindow: HTMLElement) {
  const buildingId = readBuildingId(infoWindow);
  if (!buildingId) return;
  infoWindow.setAttribute('data-building-id', buildingId);

  let panel = infoWindow.querySelector<HTMLElement>(`[${PANEL_ATTR}]`);
  if (panel) return;
  panel = document.createElement('section');
  panel.setAttribute(PANEL_ATTR, 'true');
  panel.style.marginTop = '10px';
  panel.style.paddingTop = '10px';
  panel.style.borderTop = '1px solid #dfe4ea';
  panel.innerHTML = '<div style="font-size:11px;color:#8a94a3;">正在读取租赁成交…</div>';
  infoWindow.appendChild(panel);

  void loadBuildingLeases(buildingId)
    .then(payload => renderPanel(panel!, payload))
    .catch(() => {
      if (panel) panel.innerHTML = '<div style="font-size:11px;color:#8a94a3;">租赁成交暂不可用</div>';
    });
}

function decorate(root: ParentNode) {
  root.querySelectorAll<HTMLElement>('.amap-info-content, .amap-info-outer').forEach(ensurePanel);
}

export function MapLeaseTransactionsBridge() {
  useEffect(() => {
    const run = () => decorate(document);
    run();
    const observer = new MutationObserver(records => {
      if (records.some(record => record.addedNodes.length > 0)) run();
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
