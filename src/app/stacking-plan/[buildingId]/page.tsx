import { StackingPlanWorkspace } from '@/src/components/stacking-plan/StackingPlanWorkspace';

export default async function StackingPlanPage({
  params,
}: {
  params: Promise<{ buildingId: string }>;
}) {
  const { buildingId } = await params;
  return <StackingPlanWorkspace buildingId={buildingId} />;
}
