import type { Metadata } from 'next';
import { PitchHandoffProvider } from '@/src/components/pitch/PitchHandoffLink';
import { QuarterlyResearch } from './QuarterlyResearch';
export const metadata: Metadata = { title: '季度研究｜高力国际', robots: { index: false, follow: false } };

export default function Page() {
  const enabled = process.env.PITCH_STUDIO_ENABLED === 'true';
  return <PitchHandoffProvider enabled={enabled}><QuarterlyResearch /></PitchHandoffProvider>;
}
