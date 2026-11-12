import type { AuthSessionResult } from '@/src/services/Auth';
import { getSessionIdFromAccessToken } from '@/src/utils/authSession';
import { clearUnownedProposalDraft, getProposalDraftStorage, PROPOSAL_DRAFT_STORAGE_KEY } from './proposalDraftStorage';
import type {
  ParsedRequirement,
  RequirementCapability,
  RequirementParseResult,
} from './requirementSchema';

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

export type ProposalDraftScope = string & { readonly __proposalDraftScope: unique symbol };

/** Correlates local data; application and server authorization remain separate. */
export function getProposalDraftScope(session: AuthSessionResult | null): ProposalDraftScope | null {
  const realId = session?.session?.user?.id;
  const effectiveId = session?.user.id;
  const loginId = getSessionIdFromAccessToken(session?.session?.access_token) ?? session?.sessionId;
  if (!realId || !effectiveId || !session?.role || !loginId) return null;
  return JSON.stringify([realId, effectiveId, session.role, loginId]) as ProposalDraftScope;
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

function writeProposalDraft(scope: ProposalDraftScope, draft: ProposalDraft): ProposalDraft | null {
  const target = getProposalDraftStorage();
  if (!target) return null;
  try {
    target.setItem(PROPOSAL_DRAFT_STORAGE_KEY, JSON.stringify({ scope, draft }));
    window.dispatchEvent(new Event(PROPOSAL_DRAFT_EVENT));
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

export function readProposalDraft(scope: ProposalDraftScope): ProposalDraft | null {
  const target = getProposalDraftStorage();
  if (!target) return null;
  try {
    clearUnownedProposalDraft(target);
    const raw = target.getItem(PROPOSAL_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const record = JSON.parse(raw) as { scope?: unknown; draft?: unknown } | null;
    if (record?.scope === scope && isDraft(record.draft)) return normalizeDraft(record.draft);
    target.removeItem(PROPOSAL_DRAFT_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

export function beginProposalDraft(
  scope: ProposalDraftScope,
  result: RequirementParseResult,
  appliedCapabilities: RequirementCapability['key'][],
  options?: { candidates?: Array<{ buildingId: string; buildingName: string }> },
): ProposalDraft | null {
  const safeAppliedCapabilities = [...new Set(appliedCapabilities)];
  const safeEvaluationCapabilities = defaultEvaluationCapabilities(result, safeAppliedCapabilities);
  const requirementFingerprint = fingerprint(result, safeAppliedCapabilities, safeEvaluationCapabilities);
  const previous = readProposalDraft(scope);
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
    items: options?.candidates
      ? prepareProposalCandidates(options.candidates, now)
      : previous?.requirementFingerprint === requirementFingerprint ? previous.items.slice(0, MAX_PROPOSAL_CANDIDATES) : [],
    updatedAt: now,
  };

  return writeProposalDraft(scope, next);
}

export function addProposalCandidate(scope: ProposalDraftScope, buildingId: string, buildingName: string): AddProposalCandidateResult {
  const draft = readProposalDraft(scope);
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
  const saved = writeProposalDraft(scope, next);
  return saved ? { status: 'added', draft: saved } : { status: 'unavailable', draft: null };
}

function prepareProposalCandidates(
  candidates: Array<{ buildingId: string; buildingName: string }>,
  now: string,
): ProposalDraftItem[] {
  const seen = new Set<string>();
  return candidates
    .filter(candidate => {
      const id = candidate.buildingId.trim();
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .slice(0, MAX_PROPOSAL_CANDIDATES)
    .map(candidate => ({
      buildingId: candidate.buildingId.trim(),
      buildingName: candidate.buildingName.trim() || '未命名楼宇',
      addedAt: now,
    }));
}

export function removeProposalCandidate(scope: ProposalDraftScope, buildingId: string): ProposalDraft | null {
  const draft = readProposalDraft(scope);
  if (!draft) return null;
  return writeProposalDraft(scope, {
    ...draft,
    items: draft.items.filter(item => item.buildingId !== buildingId),
    updatedAt: new Date().toISOString(),
  });
}

export function moveProposalCandidate(scope: ProposalDraftScope, buildingId: string, direction: -1 | 1): ProposalDraft | null {
  const draft = readProposalDraft(scope);
  if (!draft) return null;
  const index = draft.items.findIndex(item => item.buildingId === buildingId);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= draft.items.length) return draft;
  const items = [...draft.items];
  const [item] = items.splice(index, 1);
  if (!item) return draft;
  items.splice(nextIndex, 0, item);
  return writeProposalDraft(scope, { ...draft, items, updatedAt: new Date().toISOString() });
}

export function clearProposalCandidates(scope: ProposalDraftScope): ProposalDraft | null {
  const draft = readProposalDraft(scope);
  if (!draft) return null;
  return writeProposalDraft(scope, { ...draft, items: [], updatedAt: new Date().toISOString() });
}

export function setProposalClientName(scope: ProposalDraftScope, clientName: string): ProposalDraft | null {
  const draft = readProposalDraft(scope);
  if (!draft) return null;
  return writeProposalDraft(scope, {
    ...draft,
    clientName: clientName.slice(0, 80),
    updatedAt: new Date().toISOString(),
  });
}
