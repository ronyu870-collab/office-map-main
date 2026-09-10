'use client';

import dynamic from 'next/dynamic';

const CompareClient = dynamic(() => import('./CompareClient'), { ssr: false });

export default function ComparePage() {
  return <CompareClient />;
}
