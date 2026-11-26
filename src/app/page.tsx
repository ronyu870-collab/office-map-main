import { HomeWorkspace } from '@/src/components/home/HomeWorkspace';
import { anonymousHomeBootstrap } from '@/src/components/home/anonymousHomeBootstrap';

export default function LobbyPage() {
  return (
    <>
      <HomeWorkspace pitchStudioVisible={process.env.PITCH_STUDIO_ENABLED === 'true'} />
      {/* This parser-time redirect intentionally runs before Next's client bootstrap. */}
      {/* eslint-disable-next-line @next/next/no-sync-scripts */}
      <script dangerouslySetInnerHTML={{ __html: anonymousHomeBootstrap() }} />
    </>
  );
}
