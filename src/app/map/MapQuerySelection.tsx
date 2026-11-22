'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/src/components/ui';
import { useAppSession } from '@/src/components/SessionProvider';
import { getImpersonationTargetUserId } from '@/src/services/impersonationHeaders';
import { trustedQueryClient, type QueryClientScope } from '@/src/services/trustedQueryClient';
import type { BuildingContext } from '@/src/lib/intelligence/query/buildingCards';
import { buildingAnalysisHref, queryReturnHref, type QueryMapContext } from '@/src/lib/intelligence/query/buildingNavigation';
import { readBuildingPopupContext } from '@/src/services/map/buildingPopup';

/** No map SDK or second data store: publish an authorized ID selection to the existing workbench. */
export function MapQuerySelection({ context, onChange }: { context: QueryMapContext | null; onChange: (value: BuildingContext | null) => void }) {
  const { session } = useAppSession(), router = useRouter();
  const [result, setResult] = useState<BuildingContext | null>(null), [error, setError] = useState(''), [enabled, setEnabled] = useState(false), [retry, setRetry] = useState(0);
  const [canRentTrend, setCanRentTrend] = useState(false);
  const actor = session?.session?.user?.id, effective = session?.user?.id, sessionId = session?.sessionId, target = getImpersonationTargetUserId();
  const key = JSON.stringify([actor, effective, sessionId, target, session?.role, context]);
  useEffect(() => {
    setResult(null); setError(''); setEnabled(false); setCanRentTrend(false); onChange(null);
    if (!actor || !effective || !sessionId || target || session?.role !== 'admin') {
      if (context) setError('当前身份不能读取此 AI 结果。');
      return;
    }
    const scope: QueryClientScope = { actorId: actor, effectiveId: effective, sessionId, targetId: null };
    let request: AbortController | null = null;
    const refresh = async () => {
      request?.abort(); const controller = new AbortController(); request = controller;
      try {
        const access = await trustedQueryClient.capabilities(scope, controller.signal);
        if (controller.signal.aborted) return;
        setEnabled(access.enabled);
        setCanRentTrend(access.enabled && (access.examples ?? []).some(example => example.includes('净有效租金') && example.includes('趋势')));
        if (!access.enabled) throw new Error('当前 AI 查询资格已不可用。');
        if (context) {
          const next = await trustedQueryClient.buildings(scope, { requestId: context.requestId,
            ...(context.resultId ? { resultId: context.resultId } : {}), buildingId: context.buildingId, mapSelection:true, limit: 500 }, controller.signal);
          if (!controller.signal.aborted) { setResult(next); setError(''); onChange(next); }
        }
      } catch (reason) {
        if (!controller.signal.aborted) { setEnabled(false); setResult(null); onChange(null); if (context) setError(reason instanceof Error ? reason.message : '无法读取 AI 结果。'); }
      }
    };
    void refresh();
    const focus = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', focus);
    const timer = window.setInterval(focus, 30000);
    return () => { request?.abort(); window.clearInterval(timer); window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', focus); };
  // Identity and request references form the stable lifecycle boundary.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, retry, onChange]);
  useEffect(() => {
    const update = () => document.querySelectorAll<HTMLButtonElement>('button[data-map-action="building-ai"]').forEach(button => { button.hidden = !enabled; });
    update(); const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true });
    const click = (event: MouseEvent) => {
      const button = (event.target instanceof Element ? event.target : null)?.closest<HTMLButtonElement>('button[data-map-action="building-ai"]');
      if (!button || !enabled) return;
      const building = readBuildingPopupContext(button);
      if (!building) return;
      event.preventDefault(); event.stopPropagation();
      try { router.push(buildingAnalysisHref([building.buildingId])); } catch { /* Invalid DOM identity is never a query. */ }
    };
    document.addEventListener('click', click, true);
    return () => { observer.disconnect(); document.removeEventListener('click', click, true); };
  }, [enabled, router]);
  if (!context) return null;
  const located = result?.buildings.filter(building => building.located).length ?? 0;
  const missing = result?.buildings.filter(building => building.unavailableReason === 'missing_coordinates').length ?? 0;
  const unavailable = result?.buildings.filter(building => building.unavailableReason === 'not_in_current_map').length ?? 0;
  return <section aria-label="AI 查询地图项目" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-[var(--cd-color-border)] px-4 py-2 text-sm">
    {error ? <><p role="alert">{error}</p><Button variant="ghost" onClick={() => setRetry(value => value + 1)}>重试 AI 项目</Button></> : result ? <p role="status">本次结果 {result.total} 栋；可定位 {located} 栋{missing ? `；${missing} 栋缺少可靠坐标` : ''}{unavailable ? `；${unavailable} 栋不在当前地图目录` : ''}{result.hasMore ? '；本次显示前500栋，请缩小查询范围查看其余项目' : ''}。</p> : <p role="status">正在核对权限并读取原查询项目…</p>}
    <Link prefetch={false} className="inline-flex min-h-11 items-center text-[var(--cd-color-brand)] underline" href={queryReturnHref(context.requestId)}>返回 AI 原结果</Link>
    {result && enabled && result.buildings.length > 1 && result.buildings.length <= 20 && <Link prefetch={false} className="inline-flex min-h-11 items-center text-[var(--cd-color-brand)] underline"
      href={buildingAnalysisHref(result.buildings.map(row => row.id), result.buildings.length > 1 ? 'compare' : 'profile')}>分析选中项目</Link>}
    {result && enabled && result.buildings.length === 1 && <details className="text-[var(--cd-color-brand)]">
      <summary className="flex min-h-11 cursor-pointer items-center underline focus-visible:outline-2">继续分析此项目</summary>
      <nav aria-label="所选楼宇 AI 分析" className="flex flex-wrap gap-x-4">
        <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={buildingAnalysisHref([result.buildings[0].id])}>分析该项目</Link>
        {canRentTrend && <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={buildingAnalysisHref([result.buildings[0].id], 'rent_trend')}>历史净有效租金趋势</Link>}
        <Link prefetch={false} className="inline-flex min-h-11 items-center underline" href={buildingAnalysisHref([result.buildings[0].id], 'peers')}>查看同子市场项目</Link>
      </nav>
    </details>}
    <Link className="inline-flex min-h-11 items-center text-[var(--cd-color-brand)] underline" href="/map" prefetch={false}>返回完整地图</Link>
    <p className="w-full text-xs text-[var(--cd-color-text-secondary)]">地图沿用当前目录与地图指标；历史查询数值保留在 AI 原结果中，位置未知的项目不会生成标记。筛选仅在本组项目内生效。</p>
  </section>;
}
