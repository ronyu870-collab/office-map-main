'use client';

import dynamic from 'next/dynamic';

const MapClient = dynamic(() => import('./MapClient').then(m => m.default), {
  ssr: false,
});

export default function MapPage() {
  return <MapClient />;
}

