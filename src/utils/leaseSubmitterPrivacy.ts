type SubmissionWithIdentity = {
  submitter_id: string;
  submitter_name: string;
  original_submitter_id?: string | null;
  original_submitter_name?: string | null;
};

export function annotateSubmitterActivity<T extends SubmissionWithIdentity>(
  submissions: T[],
  activeUserIds: Set<string>,
): Array<T & { submitter_active: boolean }> {
  return submissions.map((submission) => ({
    ...submission,
    // Preserve the names recorded on the transaction even after an account is
    // disabled or a colleague leaves. Employment status is metadata, not a
    // reason to rewrite the business record's attribution.
    submitter_name: submission.submitter_name,
    original_submitter_name: submission.original_submitter_name,
    submitter_active: activeUserIds.has(submission.submitter_id),
  }));
}
