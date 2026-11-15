import type { Metadata } from 'next';
import { QuarterlyResearch } from './QuarterlyResearch';
export const metadata: Metadata = { title: '季度研究｜高力国际', robots: { index: false, follow: false } };
export default function Page() { return <QuarterlyResearch />; }
