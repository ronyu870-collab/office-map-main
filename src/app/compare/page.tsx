'use client';

import dynamic from 'next/dynamic';
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { CompareHeader } from './CompareHeader';

function CompareLoading() {
  const params = useSearchParams();
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-zinc-50">
      <CompareHeader backHref={params.get('back')} />
      <p role="status" className="sr-only">正在加载楼宇对比</p>
    </div>
  );
}

const BuildingCompareWorkspace = dynamic(() => import('./BuildingCompareWorkspace'), {
  ssr: false,
  loading: () => (
    <Suspense fallback={<p role="status">正在加载楼宇对比</p>}>
      <CompareLoading />
    </Suspense>
  ),
});

export default function ComparePage() {
  return <BuildingCompareWorkspace />;
}
