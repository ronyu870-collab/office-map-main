'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ArrowRight, MessageSquareWarning } from 'lucide-react';

const UserFeedbackDialog = dynamic(
  () => import('@/src/components/home/UserFeedbackDialog').then((module) => module.UserFeedbackDialog),
  { ssr: false },
);

type UserFeedbackLauncherProps = {
  userId: string;
  userEmail: string;
  userName: string;
};

export function UserFeedbackLauncher({ userId, userEmail, userName }: UserFeedbackLauncherProps) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="group mt-3 flex min-h-[62px] w-full items-center gap-3 rounded-[var(--cd-radius-lg)] border border-[var(--cd-color-border)] bg-[var(--cd-color-surface)] px-3.5 py-3 text-left transition-colors hover:bg-[var(--cd-color-surface-alt)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--cd-color-brand)]"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cd-radius-md)] bg-[var(--cd-color-brand-soft)] text-[var(--cd-color-brand)]">
          <MessageSquareWarning size={16} strokeWidth={1.55} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-[var(--cd-color-text-primary)]">问题与建议</span>
          <span className="mt-0.5 block truncate text-[11px] text-[var(--cd-color-text-muted)]">反馈 Bug、数据问题或功能需求</span>
        </span>
        <ArrowRight size={14} strokeWidth={1.55} className="shrink-0 text-[var(--cd-color-text-muted)] transition-colors group-hover:text-[var(--cd-color-brand)]" aria-hidden="true" />
      </button>

      {open ? (
        <UserFeedbackDialog
          open={open}
          onOpenChange={setOpen}
          userId={userId}
          userEmail={userEmail}
          userName={userName}
        />
      ) : null}
    </>
  );
}
