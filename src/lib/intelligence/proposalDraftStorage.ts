const LEGACY_PROPOSAL_DRAFT_KEY = 'colliers:intelligence-proposal-draft:v1';
export const PROPOSAL_DRAFT_STORAGE_KEY = 'colliers:intelligence-proposal-draft:v2';

export function getProposalDraftStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function clearUnownedProposalDraft(target: Storage) {
  // v1 has no recorded owner, so it cannot safely be attributed.
  target.removeItem(LEGACY_PROPOSAL_DRAFT_KEY);
}

export function clearProposalDraftStorage() {
  const target = getProposalDraftStorage();
  if (!target) return;
  try {
    target.removeItem(PROPOSAL_DRAFT_STORAGE_KEY);
    clearUnownedProposalDraft(target);
  } catch {
    // Storage can be unavailable; the authenticated UI still drops its scope.
  }
}
