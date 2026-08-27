'use client';

import * as React from 'react';

import { QuarterlyUpdateWorkspace } from './components/QuarterlyUpdateWorkspace';
import { LoadingState } from '@/src/components/ui';

export default function UpdatePage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[var(--cd-color-workspace)] px-6"><LoadingState label="正在加载季度数据填报" rows={0} /></div>
      }
    >
      <div className="h-screen overflow-hidden">
        <QuarterlyUpdateWorkspace />
      </div>
    </React.Suspense>
  );
}
