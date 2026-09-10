'use client';

import dynamic from 'next/dynamic';

const BuildingCompareWorkspace = dynamic(() => import('./BuildingCompareWorkspace'), { ssr: false });

export default function ComparePage() {
  return <BuildingCompareWorkspace />;
}
