export const INACTIVE_SUBMITTER_LABEL = '已离职成员';

type SubmissionWithIdentity = {
  submitter_id: string;
  submitter_name: string;
  original_submitter_id?: string | null;
  original_submitter_name?: string | null;
};

export function maskInactiveSubmitters<T extends SubmissionWithIdentity>(
  submissions: T[],
  activeUserIds: Set<string>,
): Array<T & { submitter_active: boolean }> {
  return submissions.map((submission) => {
    const submitterActive = activeUserIds.has(submission.submitter_id);
    const originalSubmitterActive = submission.original_submitter_id
      ? activeUserIds.has(submission.original_submitter_id)
      : submitterActive;

    return {
      ...submission,
      submitter_name: submitterActive
        ? submission.submitter_name
        : INACTIVE_SUBMITTER_LABEL,
      original_submitter_name: originalSubmitterActive
        ? submission.original_submitter_name
        : INACTIVE_SUBMITTER_LABEL,
      submitter_active: submitterActive,
    };
  });
}

