import type { ProposalBrief } from "./proposal-brief";

export type ProposalBuildingCandidate = {
  id: string;
  name: string;
  aliases?: readonly string[];
  city?: string | null;
  submarket?: string | null;
  grade?: string | null;
};

type Clarification =
  | { status: "needs-selection"; code: "missing-building" | "previous-selection-unavailable" | "comparison-scope" | "insufficient-buildings" | "multiple-targets" }
  | { status: "needs-selection"; code: "ambiguous-building"; candidates: ProposalBuildingCandidate[] };

type ResolvedBuildings = {
  status: "resolved";
  buildings: ProposalBuildingCandidate[];
  selection: "explicit" | "scoped-sample" | "none";
};

const matchKey = (text: string) => text.normalize("NFKC").toLocaleLowerCase("en").replace(/[\s·・]/g, "");
const gradeA = (text: string | null | undefined) => !!text && /^(?:甲级(?:写字楼)?|[aA]|[gG]rade\s*[aA])$/.test(text.trim());

export function findNamedProposalBuildings(phrase: string, candidates: readonly ProposalBuildingCandidate[]) {
  const query = matchKey(phrase);
  if (!query) return [];
  const distinct = [...new Map(candidates.map(building => [building.id, building])).values()];
  const exact = distinct.filter(building => [building.name, ...(building.aliases ?? [])].some(name => matchKey(name) === query));
  return exact.length ? exact : distinct.filter(building => query.length >= 3 &&
    [building.name, ...(building.aliases ?? [])].some(name => matchKey(name).includes(query)));
}

export function resolveProposalBuildings(
  brief: ProposalBrief,
  authorizedCandidates: readonly ProposalBuildingCandidate[],
): Clarification | ResolvedBuildings {
  if (brief.scenario === "market-report" || brief.scenario === "analysis-briefing") {
    return { status: "resolved", buildings: [], selection: "none" };
  }
  const catalog = [...new Map(authorizedCandidates.map(building => [building.id, building])).values()];
  const inScope = catalog.filter(candidate =>
    (!brief.city || !!candidate.city && matchKey(candidate.city) === matchKey(brief.city))
    && (!brief.submarkets.length || !!candidate.submarket && brief.submarkets.some(market => matchKey(market) === matchKey(candidate.submarket!)))
    && (!brief.grade || gradeA(candidate.grade)));
  const ids = new Map(inScope.map(candidate => [candidate.id, candidate]));
  const resolved: ProposalBuildingCandidate[] = [];
  for (const id of brief.buildingIds) {
    const candidate = ids.get(id);
    if (!candidate) return { status: "needs-selection", code: "previous-selection-unavailable" };
    resolved.push(candidate);
  }
  for (const phrase of brief.buildingQueries) {
    const candidates = findNamedProposalBuildings(phrase, inScope);
    const selected = candidates.filter(candidate => brief.buildingIds.includes(candidate.id));
    if (selected.length === 1) continue;
    if (candidates.length > 1) return { status: "needs-selection", code: "ambiguous-building", candidates: candidates.slice(0, 10) };
    if (!candidates.length) return { status: "needs-selection", code: "missing-building" };
    if (!resolved.some(entry => entry.id === candidates[0].id)) resolved.push(candidates[0]);
  }

  const compare = brief.scenario === "site-selection" || brief.scenario === "office-comparison";
  if (!compare) {
    if (resolved.length !== 1) {
      return { status: "needs-selection", code: resolved.length ? "multiple-targets" : "missing-building" };
    }
    return { status: "resolved", buildings: resolved, selection: "explicit" };
  }
  const wanted = brief.comparisonCount ?? (resolved.length >= 2 ? resolved.length : 5);
  if (wanted < 2 || wanted > 10 || resolved.length > wanted) {
    return { status: "needs-selection", code: "comparison-scope" };
  }
  if (resolved.length === wanted) return { status: "resolved", buildings: resolved, selection: "explicit" };
  if (!brief.submarkets.length) return { status: "needs-selection", code: "comparison-scope" };
  const additions = inScope.filter(candidate => !resolved.some(building => building.id === candidate.id))
    .sort((a, b) => a.name.localeCompare(b.name, "zh") || a.id.localeCompare(b.id))
    .slice(0, wanted - resolved.length);
  if (resolved.length + additions.length < wanted) return { status: "needs-selection", code: "insufficient-buildings" };
  return { status: "resolved", buildings: [...resolved, ...additions], selection: "scoped-sample" };
}

export type FormalProposalPeriod = { period: string; status: "formal" | "incomplete" };
export function resolveProposalPeriod(
  brief: Pick<ProposalBrief, "period" | "start" | "periodConflict">,
  available: readonly FormalProposalPeriod[],
) {
  if (brief.periodConflict) return { status: "conflict" } as const;
  const formal = available.filter(item => item.status === "formal").map(item => item.period).sort();
  const requested = brief.period ?? formal.at(-1);
  if (!requested) return { status: "unavailable" } as const;
  if (brief.period && available.some(item => item.period === requested && item.status === "incomplete")) {
    return { status: "incomplete", period: requested } as const;
  }
  if (!formal.includes(requested) || brief.start && !formal.includes(brief.start)) {
    return { status: "unavailable", period: requested } as const;
  }
  return { status: "resolved", period: requested, start: brief.start ?? null } as const;
}
