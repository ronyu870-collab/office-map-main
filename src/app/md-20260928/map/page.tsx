'use client';

import dynamic from 'next/dynamic';

const MeetingMapClient = dynamic(() => import('./MeetingMapClient'), {
  ssr: false,
  loading: () => (
    <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', background: '#eef2f5', color: '#607184', fontSize: 12 }}>
      正在加载高德地图…
    </div>
  ),
});

export default function MdMeetingMapPage() {
  return <MeetingMapClient />;
}
