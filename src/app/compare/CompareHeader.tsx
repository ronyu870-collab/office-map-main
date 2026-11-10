'use client';

import { ArrowLeft } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { MAX_COMPARE_COMPETITORS } from '@/src/lib/compareReadContract';

export function CompareHeader({ targetName, competitorCount }: { targetName?: string; competitorCount?: number }) {
  const router = useRouter();
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-zinc-200 bg-white px-4 py-2 shadow-sm lg:px-5 lg:py-3">
      <button type="button" onClick={() => router.push('/map')} className="flex min-h-11 items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-800 lg:min-h-0"><ArrowLeft size={16} />返回地图</button>
      <span className="text-zinc-300">|</span><h1 className="text-sm font-semibold text-zinc-800">楼宇对比</h1>
      {targetName ? <span className="truncate text-xs text-zinc-400">{targetName}</span> : null}
      {competitorCount !== undefined ? <span className="ml-auto text-xs text-zinc-400">已选 {competitorCount} / {MAX_COMPARE_COMPETITORS} 个竞品</span> : null}
    </header>
  );
}
