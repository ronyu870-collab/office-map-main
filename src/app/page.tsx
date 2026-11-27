import { PitchHandoffProvider } from '@/src/components/pitch/PitchHandoffLink';
import { HomeWorkspace } from '@/src/components/home/HomeWorkspace';
import { anonymousHomeBootstrap } from '@/src/components/home/anonymousHomeBootstrap';
import { workspaceCommandSchema } from '@/src/lib/pitch/workspace/protocol';

export default function LobbyPage() {
  const pitchEnabled = process.env.PITCH_STUDIO_ENABLED === 'true';
  const analysisReplay = pitchEnabled && workspaceCommandSchema.safeParse({
    action: 'review_handoff',
    handoff: { source: { kind: 'analysis-result', id: '11111111-1111-4111-8111-111111111111',
      resultId: '22222222-2222-4222-8222-222222222222' } },
  }).success;
  return (
    <>
      <PitchHandoffProvider enabled={pitchEnabled} analysisReplay={analysisReplay}>
        <HomeWorkspace pitchStudioVisible={pitchEnabled} />
      </PitchHandoffProvider>
      {/* This parser-time redirect intentionally runs before Next's client bootstrap. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script dangerouslySetInnerHTML={{ __html: anonymousHomeBootstrap() }} />
    </>
  );
}
