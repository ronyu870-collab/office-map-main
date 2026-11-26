import { ECOSYSTEM_BY_ID } from './ecosystem';
export type DeckKit = {
    id: string;
    version: number;
    names: {
        zh: string;
        en: string;
    };
    description: string;
    sections: {
        templateId: string;
        optional: boolean;
    }[];
    inherit: readonly [
        'language',
        'theme',
        'period',
        'project'
    ];
};
type Seed = [
    id: string,
    zh: string,
    en: string,
    ids: string
];
const seeds: Seed[] = [
    ['leasing-agency', '招商代理提案', 'Leasing agency proposal', 'mandate-summary|building-photo-overview|market-dashboard|leasing-strategy|leasing-audience|leasing-channel-plan|leasing-campaign|delivery-leadership|commercial-fee-basis|decision-request'],
    ['tenant-representation', '租户代表提案', 'Tenant representation', 'mandate-summary|occupier-demand|location-shortlist|occupier-options|stay-go-decision|occupier-cost-drivers|occupier-search-process|occupier-move-milestones|commercial-terms|decision-request'],
    ['workplace-advisory', '办公空间咨询提案', 'Workplace advisory', 'proposal-agenda|client-priorities|workplace-principles|workplace-image-brief|floorplate-options|building-technical-review|occupier-cost-drivers|delivery-workstreams|commercial-options|proposal-closing'],
    ['market-review', '市场研究汇报', 'Market review', 'proposal-agenda|market-dashboard|market-rent-evidence|market-vacancy-evidence|market-two-series|market-submarket-table|market-policy-impact|market-scenario-review|market-research-takeaway|governance-evidence-log'],
    ['asset-positioning', '资产定位与提升', 'Asset positioning', 'mandate-summary|building-photo-story|building-observation-log|building-positioning|building-renovation-brief|amenity-gallery|leasing-audience|commercial-return-assumptions|delivery-stage-gates|decision-request'],
    ['portfolio-strategy', '办公组合策略', 'Portfolio strategy', 'decision-brief|occupier-demand|location-shortlist|market-metric-panels|commercial-cost-comparison|commercial-sensitivity|proposal-assumptions|delivery-workstreams|governance-scope-change|proposal-closing'],
    ['due-diligence', '项目尽职核查', 'Project due diligence', 'engagement-scope|building-parameter-sheet|building-technical-review|arrival-experience|governance-data-quality|governance-risk-summary|governance-risk-register|commercial-terms|governance-client-approval|governance-handover'],
    ['business-review', '业务回顾与计划', 'Business review', 'mandate-summary|market-period-review|leasing-target-actual|leasing-pipeline-review|commercial-budget|commercial-value-case|delivery-outputs|governance-lessons|delivery-next-sprint|proposal-closing'],
];
export const DECK_KITS: readonly DeckKit[] = seeds.map(([id, zh, en, ids]) => ({ id, version: 1, names: { zh, en }, description: `${zh}；可整体使用或逐页选择，统一项目、语言、期间及主题。`, sections: ids.split('|').map((templateId, i) => {
        if (!ECOSYSTEM_BY_ID.has(templateId))
            throw new Error('Unregistered deck kit section');
        return { templateId, optional: i > 0 && i < ids.split('|').length - 1 };
    }), inherit: ['language', 'theme', 'period', 'project'] }));
export const DECK_KIT_BY_ID: ReadonlyMap<string, DeckKit> = new Map(DECK_KITS.map(k => [k.id, k]));
