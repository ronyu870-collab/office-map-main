'use client';

import { useImpersonation } from '@/src/contexts/ImpersonationContext';

export function ImpersonationBanner() {
  const { isImpersonating, targetEmail, targetDisplayName, targetRole, isStopping, stopImpersonation } = useImpersonation();

  if (!isImpersonating) return null;

  const identity = `正在模拟 ${targetDisplayName} (${targetEmail})`;
  return (
    <div className="fixed inset-x-0 top-0 z-[9999] flex min-h-11 items-center justify-between gap-3 bg-red-600 px-3 text-white shadow-lg sm:justify-center">
      <div className="min-w-0 text-sm leading-tight">
        <p className="truncate font-medium" title={identity}>{identity}</p>
        <p className="truncate text-white/90">{targetRole} · 只读模式</p>
      </div>
      <button
        onClick={stopImpersonation}
        disabled={isStopping}
        className="min-h-11 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium hover:bg-white/20 disabled:opacity-60"
      >
        {isStopping ? '正在退出…' : '退出模拟'}
      </button>
    </div>
  );
}
