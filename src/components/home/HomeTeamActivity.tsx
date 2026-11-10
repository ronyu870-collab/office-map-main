'use client';

import { CommunicationBoard } from '@/src/components/CommunicationBoard';
import { FeedbackPanel } from '@/src/components/FeedbackPanel';
import { NoticeBanner } from '@/src/components/NoticeBanner';

export type HomeTeamActivityProps = { userId: string; userEmail: string; userName: string };

export function HomeTeamActivity({ userId, userEmail, userName }: HomeTeamActivityProps) {
  return (
    <>
      <div className="overflow-hidden rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)]">
        <NoticeBanner />
        <div className="h-[240px] sm:h-[250px] lg:h-[270px]">
          {userEmail && <CommunicationBoard userEmail={userEmail} userName={userName} />}
        </div>
      </div>
      {userEmail && <FeedbackPanel userId={userId} userEmail={userEmail} userName={userName} />}
    </>
  );
}
