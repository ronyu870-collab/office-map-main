'use client';

import { useImpersonation } from '@/src/contexts/ImpersonationContext';

export function ImpersonationBanner() {
  const { isImpersonating, targetEmail, targetDisplayName, targetRole, stopImpersonation } = useImpersonation();

  if (!isImpersonating) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white px-4 flex items-center justify-center gap-3 shadow-lg"
      style={{ height: '40px' }}
    >
      <span className="text-sm font-medium">
        正在模拟 {targetDisplayName} ({targetEmail})
      </span>
      <span className="text-white/40">|</span>
      <span className="text-xs px-1.5 py-0.5 rounded bg-white/20">{targetRole}</span>
      <span className="text-white/40">|</span>
      <span className="text-xs text-white/80">只读模式</span>
      <button
        onClick={stopImpersonation}
        className="ml-4 rounded-md bg-white/20 px-3 py-1 text-xs font-semibold hover:bg-white/30 transition-colors"
      >
        退出模拟
      </button>
      <span className="text-xs text-white/50 ml-1">(Esc)</span>
    </div>
  );
}
