import { PATTERN_BY_ID } from '../layout/patterns/catalog';
/** Business meaning and ordered input slots, separate from geometry and theme.
 * These templates consume approved custom assets; they do not invent a data
 * connector, a corporate fact, a score or a transaction. */
export type EcosystemTemplate = {
    id: string;
    version: number;
    names: {
        zh: string;
        en: string;
    };
    group: string;
    patternId: string;
    fields: string[];
    description: string;
};
type Entry = [
    id: string,
    zh: string,
    en: string,
    patternId: string,
    fields: string
];
const groups: {
    id: string;
    entries: Entry[];
}[] = [
    { id: 'proposal', entries: [
            ['mandate-summary', '委托任务摘要', 'Mandate summary', 'executive-summary', '委托目标|工作范围|交付要求|关键约束'],
            ['proposal-agenda', '提案议程', 'Proposal agenda', 'agenda-rail', '背景与目标|分析与方案|决策与执行'],
            ['decision-brief', '决策事项简报', 'Decision brief', 'action-detail', '待决策事项|支持证据|适用边界'],
            ['client-priorities', '客户需求优先级', 'Client priorities', 'recommendation-panel', '业务需求|空间需求|时间需求|优先事项'],
            ['engagement-scope', '服务范围边界', 'Engagement scope', 'pros-cons', '纳入范围|范围外事项'],
            ['success-criteria', '项目成功标准', 'Success criteria', 'three-column-overview', '业务标准|空间标准|交付标准'],
            ['proposal-assumptions', '提案假设与条件', 'Proposal assumptions', 'risk-register', '适用前提|假设与核验表'],
            ['decision-request', '决策请求与行动', 'Decision request', 'decision-next-steps', '请求决策|下一步计划'],
            ['stakeholder-questions', '利益相关方问题树', 'Stakeholder questions', 'issue-tree', '核心问题|业务问题|财务问题|实施问题'],
            ['proposal-closing', '提案结论与依据', 'Proposal conclusion', 'quote-evidence', '主要结论|证据边界|责任与日期'],
        ] },
    { id: 'building', entries: [
            ['building-photo-overview', '楼宇照片与核心参数', 'Building visual overview', 'photo-kpi', '项目照片|办公面积|标准层面积|可用车位'],
            ['building-parameter-sheet', '楼宇技术参数', 'Building specification', 'photo-table', '项目照片|楼宇概况|参数明细'],
            ['arrival-experience', '项目到达体验', 'Arrival experience', 'photo-triptych', '入口照片|大堂照片|垂直交通照片|入口说明|大堂说明|交通说明'],
            ['amenity-gallery', '项目配套图集', 'Amenity gallery', 'photo-gallery', '餐饮照片|餐饮说明|会议照片|会议说明|健身照片|健身说明|公共区照片|公共区说明'],
            ['floorplate-options', '标准层方案对照', 'Floorplate alternatives', 'photo-pair', '方案图一|方案图二|使用条件'],
            ['building-technical-review', '项目技术条件核对', 'Technical due diligence', 'table-insight', '核对记录|关键限制'],
            ['building-positioning', '项目定位框架', 'Building positioning', 'strategy-house', '定位主张|目标客群|空间产品|服务配套|事实基础'],
            ['building-photo-story', '项目空间叙事', 'Building photo story', 'editorial-photo', '空间特征|使用边界|项目照片'],
            ['building-observation-log', '现场观察记录', 'Site observations', 'gallery-commentary', '现场图一|现场图二|现场图三|现场图四|观察与待核验事项'],
            ['building-renovation-brief', '改造前后方案', 'Renovation brief', 'before-after', '现状条件|经确认的目标方案'],
        ] },
    { id: 'occupier', entries: [
            ['occupier-demand', '租户需求概要', 'Occupier requirements', 'quadrant-framework', '业务需求|人员需求|空间需求|时间与预算'],
            ['workplace-principles', '办公空间设计原则', 'Workplace principles', 'value-chain', '业务目标|员工需求|空间配置|服务运营|效果验证|原则适用范围'],
            ['location-shortlist', '选址候选项目', 'Location shortlist', 'comparison-tables', '候选项目表|约束核对表|筛选依据'],
            ['occupier-options', '租赁方案评价', 'Lease option review', 'scorecard-summary', '方案评分表|关键指标|评分方法'],
            ['stay-go-decision', '续租与搬迁决策', 'Stay or relocate', 'problem-solution', '续租条件|搬迁条件'],
            ['workplace-image-brief', '办公空间意向', 'Workplace image brief', 'hero-caption', '获权空间参考图|意向说明'],
            ['occupier-cost-drivers', '租户成本驱动因素', 'Occupier cost drivers', 'metric-bridge', '租赁成本|装修成本|搬迁成本|统一期间与成本范围'],
            ['occupier-search-process', '选址服务流程', 'Location search process', 'process-chevron', '需求定义|方案筛选|条款评估|需求交付|候选交付|决策交付'],
            ['occupier-move-milestones', '搬迁关键里程碑', 'Relocation milestones', 'milestone-strip', '关键节点|交付边界'],
            ['occupier-approval-path', '租户内部决策路径', 'Occupier approval path', 'vertical-steps', '业务确认|财务确认|管理层决策|审批前提'],
        ] },
    { id: 'leasing', entries: [
            ['leasing-strategy', '招商策略摘要', 'Leasing strategy', 'executive-summary', '招商目标|目标行业|产品策略|执行重点'],
            ['leasing-audience', '目标客群分层', 'Target audience tiers', 'qualitative-funnel', '重点客群|适配客群|观察客群'],
            ['leasing-channel-plan', '招商渠道分工', 'Leasing channel plan', 'three-column-overview', '直接拓展|代理合作|品牌活动'],
            ['leasing-campaign', '招商活动路线', 'Leasing campaign roadmap', 'roadmap-lanes', '客户拓展|拓展安排|渠道合作|合作安排|项目推广|推广安排'],
            ['leasing-conversion-review', '招商转化数据核对', 'Leasing conversion review', 'chart-table', '转化统计|真实样本明细'],
            ['leasing-target-actual', '招商目标与实际', 'Leasing target and actual', 'metric-comparison', '计划面积|实际面积|计划依据|实际口径'],
            ['leasing-pipeline-review', '招商机会清单', 'Leasing pipeline review', 'table-conclusion', '获权机会记录|当前行动'],
            ['leasing-objection-response', '招商障碍与回应', 'Leasing objections', 'issue-tree', '核心障碍|价格条件|产品条件|时间条件'],
            ['leasing-feedback-loop', '招商反馈闭环', 'Leasing feedback cycle', 'cycle-four', '收集反馈|核验信息|调整方案|回访确认'],
            ['leasing-property-story', '招商空间卖点', 'Leasing space story', 'photo-triptych', '产品照片|服务照片|配套照片|产品事实|服务事实|配套事实'],
        ] },
    { id: 'market', entries: [
            ['market-dashboard', '市场观察看板', 'Market observation dashboard', 'kpi-chart-dashboard', '样本办公面积|空置率|净有效租金|同口径趋势'],
            ['market-rent-evidence', '租金趋势与解释', 'Rent trend evidence', 'chart-evidence', '净有效租金趋势|经确认的解释|样本量'],
            ['market-vacancy-evidence', '空置变化与样本', 'Vacancy and sample', 'kpi-rail-chart', '期初空置率|期末空置率|有效样本量|空置率趋势'],
            ['market-two-series', '供需双图分析', 'Supply and demand panels', 'dual-chart', '存量或供应统计|经确认需求统计'],
            ['market-metric-panels', '租金空置成交三图', 'Three market panels', 'chart-triptych', '净有效租金|有效空置率|租赁成交面积'],
            ['market-period-review', '分期间市场回顾', 'Market period review', 'chart-stack', '历史净有效租金|历史空置率'],
            ['market-submarket-table', '子市场数据与观点', 'Submarket evidence', 'table-insight', '子市场正式数据|研究观点与边界'],
            ['market-policy-impact', '政策事实与适用性', 'Policy applicability', 'action-detail', '政策原文要点|适用对象|生效与限制'],
            ['market-research-takeaway', '研究结论与证据', 'Research takeaway', 'quote-evidence', '已发布研究观点|证据及限制|原研究日期'],
            ['market-scenario-review', '市场情景假设', 'Market scenarios', 'quadrant-framework', '基准假设|上行情景|下行情景|敏感条件'],
        ] },
    { id: 'delivery', entries: [
            ['service-delivery-model', '服务交付模式', 'Service delivery model', 'strategy-house', '交付承诺|客户协作|研究支持|执行交付|资源与范围'],
            ['delivery-workstreams', '项目工作流', 'Delivery workstreams', 'roadmap-lanes', '研究工作流|研究计划|客户工作流|客户计划|执行工作流|执行计划'],
            ['delivery-timeline', '项目执行时间轴', 'Delivery timeline', 'timeline-alternating', '执行节点'],
            ['delivery-stage-gates', '项目阶段门', 'Delivery stage gates', 'staircase', '需求确认|方案确认|执行确认'],
            ['delivery-responsibility', '项目职责与成果', 'Delivery responsibilities', 'risk-register', '责任边界|职责分配表'],
            ['delivery-quality-cycle', '交付质量闭环', 'Delivery quality cycle', 'cycle-four', '标准定义|过程检查|问题修正|复核交付'],
            ['delivery-leadership', '项目负责人及团队', 'Delivery leadership', 'leader-team', '项目负责人|协作团队'],
            ['delivery-expertise', '项目人员履历', 'Delivery expertise', 'team-directory', '参与成员及已确认履历'],
            ['delivery-outputs', '阶段成果对照', 'Delivery outputs', 'comparison-tables', '计划交付清单|已完成成果|差异与行动'],
            ['delivery-next-sprint', '下一阶段行动', 'Next delivery stage', 'decision-next-steps', '当前决策|阶段安排'],
        ] },
    { id: 'commercial', entries: [
            ['commercial-fee-basis', '服务费用与范围', 'Fee basis and scope', 'table-insight', '费用组成表|计费口径与排除项'],
            ['commercial-budget', '预算与执行', 'Budget and actual', 'metric-comparison', '经确认预算|实际支出|预算范围|支出口径'],
            ['commercial-cost-comparison', '成本方案比较', 'Cost option comparison', 'chart-table', '同期间成本比较|完整成本假设'],
            ['commercial-return-assumptions', '收益测算前提', 'Return assumptions', 'fact-and-context', '经确认测算值|计算方法与假设'],
            ['commercial-sensitivity', '成本敏感性分析', 'Cost sensitivity', 'dual-chart', '租金敏感性样本|装修敏感性样本'],
            ['commercial-value-case', '服务价值案例', 'Service value case', 'case-outcomes', '经批准案例展示|已确认成果值|样本或规模'],
            ['commercial-terms', '商务条款清单', 'Commercial terms', 'table-conclusion', '经确认条款|需要确认的事项'],
            ['commercial-negotiation', '谈判事项与边界', 'Negotiation issues', 'pros-cons', '可讨论条件|不可突破边界'],
            ['commercial-options', '报价方案条件', 'Commercial alternatives', 'three-column-overview', '方案一条件|方案二条件|选择原则'],
            ['commercial-approval', '商务审批要点', 'Commercial approval', 'recommendation-panel', '费用事项|责任事项|时点事项|审批请求'],
        ] },
    { id: 'governance', entries: [
            ['governance-risk-summary', '项目风险摘要', 'Project risk summary', 'executive-summary', '风险概述|已知风险|未确认事项|应对安排'],
            ['governance-risk-register', '风险与责任人', 'Risk ownership', 'risk-register', '风险评估边界|风险与责任记录'],
            ['governance-data-quality', '数据质量记录', 'Data quality record', 'table-conclusion', '来源与核验清单|使用限制'],
            ['governance-issue-resolution', '问题解决路径', 'Issue resolution', 'vertical-steps', '记录问题|确认责任|验证关闭|升级条件'],
            ['governance-client-approval', '客户确认事项', 'Client confirmations', 'agenda-rail', '事实确认|方案确认|执行确认'],
            ['governance-scope-change', '范围变更影响', 'Scope change impact', 'before-after', '原确认范围|变更范围与影响'],
            ['governance-evidence-log', '来源与证据索引', 'Evidence index', 'table-insight', '来源记录|有效期与披露边界'],
            ['governance-lessons', '项目复盘与经验', 'Project lessons', 'problem-solution', '已观察问题|经确认改进'],
            ['governance-review-principles', '项目复核原则', 'Review principles', 'value-chain', '事实核验|口径一致|权限复核|交付检查|历史追溯|适用范围'],
            ['governance-handover', '项目移交计划', 'Project handover', 'milestone-strip', '移交节点|移交条件与责任'],
        ] },
];
export const ECOSYSTEM_TEMPLATES: readonly EcosystemTemplate[] = groups.flatMap(g => g.entries.map(([id, zh, en, patternId, fields]) => {
    const pattern = PATTERN_BY_ID.get(patternId), labels = fields.split('|');
    if (!pattern || labels.length !== pattern.slots.length)
        throw new Error(`Invalid business slot contract: ${id}`);
    return { id, version: 1, names: { zh, en }, group: g.id, patternId, fields: labels, description: `${zh}；输入${labels.join('、')}，使用获权资料，保留来源与期间。` };
}));
export const ECOSYSTEM_BY_ID: ReadonlyMap<string, EcosystemTemplate> = new Map(ECOSYSTEM_TEMPLATES.map(t => [t.id, t]));
if (ECOSYSTEM_BY_ID.size !== ECOSYSTEM_TEMPLATES.length)
    throw new Error('Duplicate business template ID');
