'use client';

import * as React from 'react';

interface DataEntryToolbarProps {
  children: React.ReactNode;
  leading?: React.ReactNode;
  className?: string;
}

export function DataEntryToolbar({ children, leading, className = '' }: DataEntryToolbarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-white px-3 py-2.5 sm:px-4 ${className}`}>
      {leading && <div className="mr-auto min-w-0">{leading}</div>}
      <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{children}</div>
    </div>
  );
}
