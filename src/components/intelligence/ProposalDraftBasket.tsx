'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, X } from 'lucide-react';

import { Button } from '@/src/components/ui';
import {
  clearProposalCandidates,
  MAX_PROPOSAL_CANDIDATES,
  PROPOSAL_DRAFT_EVENT,
  readProposalDraft,
  removeProposalCandidate,
  type ProposalDraft,
} from '@/src/lib/intelligence/proposalDraft';

export default function ProposalDraftBasket() {
  const [draft, setDraft] = React.useState<ProposalDraft | null>(null);

  React.useEffect(() => {
    const sync = () => setDraft(readProposalDraft());
    sync();
    window.addEventListener(PROPOSAL_DRAFT_EVENT, sync);
    return () => window.removeEventListener(PROPOSAL_DRAFT_EVENT, sync);
  }, []);

  const count = draft?.items.length ?? 0;

  return (
    <aside className="pointer-events-auto absolute bottom-[82px] right-4 z-[345] hidden w-[310px] overflow-hidden rounded-[8px] border border-[var(--cd-color-border-strong)] bg-white shadow-[0_8px_28px_rgba(23,32,51,0.16)] md:block" aria-label="客户方案草稿">
      <div className="flex items-center justify-between border-b border-slate-200/80 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
            <BriefcaseBusiness size={14} aria-hidden="true" />
          </div>
          <div>
            <div className="text-[12px] font-semibold text-slate-900">客户方案</div>
            <div className="text-[10px] text-slate-400">已选择 {count}/{MAX_PROPOSAL_CANDIDATES}</div>
          </div>
        </div>
        {count > 0 ? (
          <button type="button" onClick={() => setDraft(clearProposalCandidates())} className="text-[10px] text-slate-400 transition hover:text-slate-700">清空</button>
        ) : null}
      </div>

      <div className="max-h-[210px] overflow-y-auto px-3 py-2.5">
        {draft?.items.length ? draft.items.map((item, index) => (
          <div key={item.buildingId} className="flex items-center gap-2 border-b border-slate-100 py-2 last:border-b-0">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-semibold text-slate-500">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-slate-700" title={item.buildingName}>{item.buildingName}</span>
            <button
              type="button"
              onClick={() => setDraft(removeProposalCandidate(item.buildingId))}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-slate-300 transition hover:bg-slate-100 hover:text-slate-600"
              aria-label={`移除${item.buildingName}`}
            >
              <X size={12} aria-hidden="true" />
            </button>
          </div>
        )) : (
          <div className="py-4 text-center text-[11px] leading-5 text-slate-400">
            打开候选楼宇详情，点击“加入客户方案”。
          </div>
        )}
      </div>

      <div className="border-t border-slate-200/80 p-3">
        {count > 0 ? (
          <Link href="/intelligence/proposal" className="flex h-8 w-full items-center justify-center gap-1.5 rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand)] px-3 text-[11px] font-medium text-white transition hover:opacity-90">
            查看候选方案 <ArrowRight size={12} aria-hidden="true" />
          </Link>
        ) : (
          <Button type="button" size="sm" variant="secondary" disabled className="w-full">请先选择候选项目</Button>
        )}
      </div>
    </aside>
  );
}
