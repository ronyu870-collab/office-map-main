'use client';

import dynamic from 'next/dynamic';
import { CompareHeader } from './CompareHeader';

const BuildingCompareWorkspace = dynamic(() => import('./BuildingCompareWorkspace'), {
  ssr: false,
  loading: () => (
    <div className="flex h-dvh min-h-0 flex-col bg-zinc-50">
      <CompareHeader />
      <p role="status" className="sr-only">正在加载楼宇对比</p>
    </div>
  ),
});

export default function ComparePage() {
  return <BuildingCompareWorkspace />;
}
