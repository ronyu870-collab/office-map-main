import type {
  ParsedRequirement,
  RequirementCapability,
  RequirementParseResult,
} from './requirementSchema';

export const PROPOSAL_DRAFT_STORAGE_KEY = 'colliers:intelligence-proposal-draft:v1';
export const PROPOSAL_DRAFT_EVENT = 'intelligence-proposal-draft-changed';
export const MAX_PROPOSAL_CANDIDATES = 5;

type ProposalRequirementContext = {
  parsed: ParsedRequirement;
  capabilities: RequirementCapability[];
  appliedCapabilities: RequirementCapability['key'][];
  evaluationCapabilities: RequirementCapability['key'][];
};

export type ProposalDraftItem = {
  buildingId: string;
  buildingName: string;
  addedAt: string;
};

export type ProposalDraft = {
  version: 1;
  clientName: string;
  requirementFingerprint: string;
  requirement: ProposalRequirementContext;
  items: ProposalDraftItem[];
  updatedAt: string;
};

export type AddProposalCandidateResult = {
  status: 'added' | 'exists' | 'full' | 'unavailable';
  draft: ProposalDraft | null;
};

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isDraft(value: unknown): value is ProposalDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<ProposalDraft>;
  const requirement = draft.requirement as Partial<ProposalRequirementContext> | undefined;
  return draft.version === 1
    && typeof draft.clientName === 'string'
    && typeof draft.requirementFingerprint === 'string'
    && Boolean(requirement && typeof requirement === 'object')
    && Array.isArray(requirement?.appliedCapabilities)
    && (requirement?.evaluationCapabilities === undefined || Array.isArray(requirement?.evaluationCapabilities))
    && Array.isArray(draft.items)
    && draft.items.every(item => Boolean(
      item
      && typeof item.buildingId === 'string'
      && typeof item.buildingName === 'string'
      && typeof item.addedAt === 'string',
    ))
    && typeof draft.updatedAt === 'string';
}

function normalizeDraft(draft: ProposalDraft): ProposalDraft {
  if (Array.isArray(draft.requirement.evaluationCapabilities)) return draft;
  return {
    ...draft,
    requirement: {
      ...draft.requirement,
      evaluationCapabilities: [...draft.requirement.appliedCapabilities],
    },
  };
}

function writeProposalDraft(draft: ProposalDraft): ProposalDraft | null {
  const target = storage();
  if (!target) return null;
  try {
    target.setItem(PROPOSAL_DRAFT_STORAGE_KEY, JSON.stringify(draft));
    window.dispatchEvent(new CustomEvent<ProposalDraft>(PROPOSAL_DRAFT_EVENT, { detail: draft }));
    return draft;
  } catch {
    return null;
  }
}

function fingerprint(
  result: RequirementParseResult,
  appliedCapabilities: RequirementCapability['key'][],
  evaluationCapabilities: RequirementCapability['key'][],
): string {
  return JSON.stringify({
    parsed: result.parsed,
    capabilityStatuses: result.capabilities.map(item => ({ key: item.key, status: item.status })),
    appliedCapabilities,
    evaluationCapabilities,
  });
}

function defaultEvaluationCapabilities(
  result: RequirementParseResult,
  appliedCapabilities: RequirementCapability['key'][],
) {
  const keys = new Set<RequirementCapability['key']>(appliedCapabilities);
  if (result.parsed.grades.length > 0) keys.add('grade');
  if (result.parsed.metro.preferred || result.parsed.metro.maxDistanceMeters !== null) keys.add('metro');
  if (result.parsed.greenCertifications.length > 0) keys.add('green');
  return [...keys];
}

export function readProposalDraft(): ProposalDraft | null {
  const target = storage();
  if (!target) return null;
  try {
    const raw = target.getItem(PROPOSAL_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isDraft(parsed) ? normalizeDraft(parsed) : null;
  } catch {
    return null;
  }
}

export function beginProposalDraft(
  result: RequirementParseResult,
  appliedCapabilities: RequirementCapability['key'][],
  evaluationCapabilities?: RequirementCapability['key'][],
): ProposalDraft | null {
  const safeAppliedCapabilities = [...new Set(appliedCapabilities)];
  const safeEvaluationCapabilities = [...new Set(
    evaluationCapabilities ?? defaultEvaluationCapabilities(result, safeAppliedCapabilities),
  )];
  const requirementFingerprint = fingerprint(result, safeAppliedCapabilities, safeEvaluationCapabilities);
  const previous = readProposalDraft();
  const now = new Date().toISOString();

  const next: ProposalDraft = {
    version: 1,
    clientName: previous?.requirementFingerprint === requirementFingerprint ? previous.clientName : '',
    requirementFingerprint,
    requirement: {
      parsed: result.parsed,
      capabilities: result.capabilities,
      appliedCapabilities: safeAppliedCapabilities,
      evaluationCapabilities: safeEvaluationCapabilities,
    },
    items: previous?.requirementFingerprint === requirementFingerprint ? previous.items.slice(0, MAX_PROPOSAL_CANDIDATES) : [],
    updatedAt: now,
  };

  return writeProposalDraft(next);
}

export function addProposalCandidate(buildingId: string, buildingName: string): AddProposalCandidateResult {
  const draft = readProposalDraft();
  if (!draft) return { status: 'unavailable', draft: null };
  if (draft.items.some(item => item.buildingId === buildingId)) return { status: 'exists', draft };
  if (draft.items.length >= MAX_PROPOSAL_CANDIDATES) return { status: 'full', draft };

  const next: ProposalDraft = {
    ...draft,
    items: [...draft.items, {
      buildingId,
      buildingName: buildingName.trim() || '未命名楼宇',
      addedAt: new Date().toISOString(),
    }],
    updatedAt: new Date().toISOString(),
  };
  return { status: 'added', draft: writeProposalDraft(next) };
}

export function setProposalCandidates(
  candidates: Array<{ buildingId: string; buildingName: string }>,
): ProposalDraft | null {
  const draft = readProposalDraft();
  if (!draft) return null;
  const seen = new Set<string>();
  const now = new Date().toISOString();
  const items = candidates
    .filter(candidate => {
      const id = candidate.buildingId.trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_PROPOSAL_CANDIDATES)
    .map(candidate => ({
      buildingId: candidate.buildingId,
      buildingName: candidate.buildingName.trim() || '未命名楼宇',
      addedAt: now,
    }));
  return writeProposalDraft({ ...draft, items, updatedAt: now });
}

export function removeProposalCandidate(buildingId: string): ProposalDraft | null {
  const draft = readProposalDraft();
  if (!draft) return null;
  return writeProposalDraft({
    ...draft,
    items: draft.items.filter(item => item.buildingId !== buildingId),
    updatedAt: new Date().toISOString(),
  });
}

export function moveProposalCandidate(buildingId: string, direction: -1 | 1): ProposalDraft | null {
  const draft = readProposalDraft();
  if (!draft) return null;
  const index = draft.items.findIndex(item => item.buildingId === buildingId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= draft.items.length) return draft;
  const items = [...draft.items];
  const [item] = items.splice(index, 1);
  if (!item) return draft;
  items.splice(nextIndex, 0, item);
  return writeProposalDraft({ ...draft, items, updatedAt: new Date().toISOString() });
}

export function clearProposalCandidates(): ProposalDraft | null {
  const draft = readProposalDraft();
  if (!draft) return null;
  return writeProposalDraft({ ...draft, items: [], updatedAt: new Date().toISOString() });
}

export function setProposalClientName(clientName: string): ProposalDraft | null {
  const draft = readProposalDraft();
  if (!draft) return null;
  return writeProposalDraft({
    ...draft,
    clientName: clientName.slice(0, 80),
    updatedAt: new Date().toISOString(),
  });
}
