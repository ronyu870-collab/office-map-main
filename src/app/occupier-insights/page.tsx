import type { Metadata } from 'next';
import { OccupierInsightsReport } from './OccupierInsightsReport';

export const metadata: Metadata = {
  title: '企业选址洞察｜北京办公楼市场数据平台',
  description: '从第三方租户调研出发，梳理企业办公选址的区位、成本、空间与租约问题。',
  robots: { index: false, follow: false },
};

export default function OccupierInsightsPage() {
  return <OccupierInsightsReport />;
}
