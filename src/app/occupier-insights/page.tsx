import type { Metadata } from 'next';
import { OccupierInsightsReport } from './OccupierInsightsReport';

export const metadata: Metadata = {
  title: '企业选址洞察｜北京办公楼市场数据平台',
  description: '从企业增长、产业生态与租赁风险，到办公体验、可持续运营和选址决策。',
  robots: { index: false, follow: false },
};
export default function OccupierInsightsPage() { return <OccupierInsightsReport />; }
