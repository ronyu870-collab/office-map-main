import type { Metadata } from 'next';
import { OccupierInsightsReport } from './OccupierInsightsReport';

export const metadata: Metadata = {
  title: '企业选址洞察｜高力国际北京办公楼市场数据平台',
  description: '解读企业办公选址的行业与产业生态、布局策略、租赁风险、员工体验和总占用成本，并提供北京看楼的核验方法。',
  robots: { index: false, follow: false },
};

export default function OccupierInsightsPage() {
  return <OccupierInsightsReport />;
}
