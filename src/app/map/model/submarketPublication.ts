import { emptySubmarketProfile, type SubmarketProfile, type SubmarketProfileDraft } from './submarketProfile';

/**
 * Customer-facing content hygiene only, not a factual-review or approval workflow.
 * Automatic publication does not assert that any human reviewed a source.
 */
const internalMarkers = /(?:草稿|草案|待复核|待审核|待维护|待核查|研究提示|研究初稿|业务团队复核|内部|内参|未经批准|非正式|不作为高力国际|非高力国际|尚未核实|AI(?:公开|基于|依据|整理|生成|撰写)|由AI|人工智能生成)/i;

export function publicBriefReviewErrors(draft: SubmarketProfileDraft): string[] {
  const errors: string[] = [];
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
    if (internalMarkers.test(text)) errors.push(label + '仍包含草案或内部标记');
  }
  return [...new Set(errors)];
}

export function visibleSubmarketProfile(profile: SubmarketProfile, published: boolean): SubmarketProfile {
  // Block unsafe legacy drafts, but display complete auto-published briefs immediately.
  if (published && publicBriefReviewErrors(profile).length === 0) return profile;
  return { ...emptySubmarketProfile(), submarket: profile.submarket, updatedAt: null, updatedBy: null };
}
