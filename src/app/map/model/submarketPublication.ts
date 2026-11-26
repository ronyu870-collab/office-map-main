import { emptySubmarketProfile, type SubmarketProfile, type SubmarketProfileDraft } from './submarketProfile';
import { internalResearchMarkers, structuredResearchCopy } from './submarketIntelligence';

/**
 * Customer-facing content hygiene only, not a factual-review or approval workflow.
 * Automatic publication does not assert that any human reviewed a source.
 */
export function publicBriefReviewErrors(draft: SubmarketProfileDraft): string[] {
  const errors: string[] = [];
  if (draft.research) {
    if (structuredResearchCopy(draft.research).some(value => internalResearchMarkers.test(value))) {
      errors.push('研究资料包含草案或内部说明');
    }
    return errors;
  }
  for (const [field, label] of [
    ['headline', '市场定位'], ['overview', '区域概况'],
    ['industries', '产业特点'], ['transport', '交通条件'],
  ] as const) {
    if (!draft[field].trim()) errors.push(label + '尚未填写');
  }
  const sections: Array<[string, string]> = [
    ['市场定位', draft.headline],
    ['区域概况', draft.overview],
    ['产业特点', draft.industries],
    ['交通条件', draft.transport],
    ...draft.demographics.map(row => ['人口与就业', Object.values(row).join(' ')] as [string, string]),
    ...draft.policies.map(row => ['政策资料', Object.values(row).join(' ')] as [string, string]),
    ...draft.insights.map(row => ['研究观点', Object.values(row).join(' ')] as [string, string]),
  ];
  for (const [label, text] of sections) {
    if (internalResearchMarkers.test(text)) errors.push(label + '仍包含草案或内部标记');
  }
  return [...new Set(errors)];
}

export function visibleSubmarketProfile(profile: SubmarketProfile, published: boolean): SubmarketProfile {
  // Block unsafe legacy drafts, but display complete auto-published briefs immediately.
  if (published && publicBriefReviewErrors(profile).length === 0) {
    if (profile.research) {
      // The structured edition is reviewed as one unit. Legacy editor copy is not part of it.
      return { ...emptySubmarketProfile(), submarket: profile.submarket, updatedAt: profile.updatedAt,
        updatedBy: null, headline: profile.research.positioning, research: profile.research };
    }
    return profile;
  }
  return { ...emptySubmarketProfile(), submarket: profile.submarket, updatedAt: null, updatedBy: null };
}
