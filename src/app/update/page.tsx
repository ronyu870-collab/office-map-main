'use client';

import * as React from 'react';

import { QuarterlyUpdateWorkspace } from './components/QuarterlyUpdateWorkspace';

export default function UpdatePage() {
  return (
    <React.Suspense
      fallback={
        <div className="flex h-screen items-center justify-center bg-[#f3f5f7]">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-200 border-t-[#003e7e]" />
        </div>
      }
    >
      <div className="h-screen overflow-hidden">
        <span className="sr-only">季度数据填报</span>
        <QuarterlyUpdateWorkspace />
      </div>
    </React.Suspense>
  );
}
