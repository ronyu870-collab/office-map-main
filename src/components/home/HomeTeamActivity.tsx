'use client';

import { CommunicationBoard } from '@/src/components/CommunicationBoard';
import { FeedbackPanel } from '@/src/components/FeedbackPanel';
import { NoticeBanner } from '@/src/components/NoticeBanner';
import styles from './HomeWorkspace.module.css';

export type HomeTeamActivityProps = { userId: string; userEmail: string; userName: string };

export function HomeTeamActivity({ userId, userEmail, userName }: HomeTeamActivityProps) {
  return (
    <>
      <div className={styles.activityGrid}>
        <NoticeBanner />
        <div className={styles.communication}>
          {userEmail && <CommunicationBoard userEmail={userEmail} userName={userName} />}
        </div>
      </div>
      {userEmail && <div className={styles.feedback}><FeedbackPanel key={JSON.stringify([userId, userEmail])} userId={userId} userEmail={userEmail} userName={userName} /></div>}
    </>
  );
}
