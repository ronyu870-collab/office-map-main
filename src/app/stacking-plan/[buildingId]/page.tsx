import { StackingPlanWorkspace } from '@/src/components/stacking-plan/StackingPlanWorkspace';
import { PitchHandoffProvider } from '@/src/components/pitch/PitchHandoffLink';
import { brokerReturn } from '@/src/lib/broker/links';

export default async function StackingPlanPage({
  params,
  searchParams,
}: {
  params: Promise<{ buildingId: string }>;
  searchParams: Promise<{ back?: string }>;
}) {
  const { buildingId } = await params;
  const { back } = await searchParams;
  return <PitchHandoffProvider enabled={process.env.PITCH_STUDIO_ENABLED === 'true'}>
    <StackingPlanWorkspace buildingId={buildingId} backHref={brokerReturn(back)} />
  </PitchHandoffProvider>;
}
