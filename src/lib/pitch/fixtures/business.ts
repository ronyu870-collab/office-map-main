import { slideContentSchema, type SlideContent } from '../contracts/content';
import { businessProfileSchema } from '../business/protocol';
import { buildBusinessPages, type BusinessAsset, type BusinessPage } from '../business/content';
import { BUSINESS_RECIPES, DYNAMIC_CAPABILITIES } from '../business/recipes';
import { ECOSYSTEM_BY_ID } from '../templates/ecosystem';
import { ecosystemFixture } from './ecosystem';
/** Publicly inspectable, independently authored examples, never company facts.
 * The same builder feeds thumbnails, private example copies and file tests. */
export function templateExample(id: string, language: 'zh' | 'en', sourceId: string, mediaId: string): BusinessPage[] {
    const en = language === 'en', refs = [sourceId], date = '2026-01-01';
    const text = (zh: string, enText: string) => ({ zh, en: enText });
    const base = slideContentSchema.parse({ protocol: 'colliers-pitch/1', locale: language, title: en ? 'Synthetic project example' : '合成项目示例', dataAsOf: date, isTestData: true, disclosure: 'internal', sources: [{ id: sourceId, kind: 'synthetic', label: en ? 'Synthetic examples, not corporate facts' : '合成示例，非企业正式事实', locator: 'template-example:' + id, version: '1', dataAsOf: date }], blocks: [{ kind: 'paragraph', text: en ? 'Assess the synthetic office requirement and confirm the project scope.' : '评估合成办公需求，确认项目范围及交付条件。', sourceIds: refs }] });
    const recipe = BUSINESS_RECIPES.find(r => r.id === id);
    if (!recipe) {
        const dynamic = DYNAMIC_CAPABILITIES.find(r => r.id === id && r.status === 'available');
        if (!dynamic)
            throw new Error('PITCH_TEMPLATE_UNAVAILABLE');
        const table = ['building-profile', 'project-comparison', 'building-submarket', 'lease-representatives'].includes(id);
        const comparison = id.endsWith('comparison'), vacancy = id.includes('vacancy'), industry = id.includes('industry');
        const content: SlideContent = { ...base, title: dynamic.name, blocks: table ? [{ kind: 'table', columns: en ? ['Synthetic project', 'Office area (m²)', 'Period'] : ['合成项目', '办公面积 (m²)', '期间'], rows: [[en ? 'Example A' : '示例 A', 1200, '2026-Q1'], [en ? 'Example B' : '示例 B', null, '2026-Q1']], sourceIds: refs }] : [{ kind: 'chart', chartType: industry ? 'bar' : comparison ? 'column' : 'line', categories: industry ? (en ? ['Technology', 'Other'] : ['科技', '其他']) : comparison ? (en ? ['Example A', 'Example B'] : ['示例 A', '示例 B']) : ['2025-Q4', '2026-Q1'], series: [{ name: en ? 'Synthetic sample' : '合成样本', unit: vacancy ? '%' : industry ? (en ? 'count' : '笔') : 'RMB/m²/month', values: vacancy ? [10, 8] : industry ? [3, 2] : [100, 110] }], sourceIds: refs }] };
        return [{ content, layoutId: table ? 'data-table' : 'chart-insight', variant: 'standard' }];
    }
    const spec = ECOSYSTEM_BY_ID.get(id), content = spec ? ecosystemFixture(id, language, sourceId, mediaId) : base;
    const kind = recipe.accepts[0];
    const profile = kind === 'corporate' ? { kind, coverage: 'regional', fallbackFor: [], brief: text('合成企业的简洁介绍，仅展示信息组织方式。', 'A synthetic company overview demonstrating information structure.'), detailed: text('示例企业 A 提供约定范围内的咨询服务。本页为工程示例，不代表高力国际事实。', 'Synthetic company A provides services within an agreed scope. This is not a Colliers corporate statement.'), capabilities: [text('需求研究与方案评估', 'Requirements research and option evaluation'), text('项目协调与交付复核', 'Project coordination and delivery review')], honors: [], metrics: [{ label: text('示例项目数', 'Example projects'), value: 12, unit: en ? 'projects' : '个' }, { label: text('未提供的指标', 'Unavailable measure'), value: null, unit: en ? 'people' : '人' }], photos: [] } :
        kind === 'team' ? { kind, employeeAccountId: null, name: text('测试成员 A', 'Test member A'), position: text('合成项目角色', 'Synthetic project role'), team: en ? 'Example team' : '示例团队', expertise: [en ? 'Office requirements' : '办公需求'], experience: text('合成履历，用于验证页面排版。', 'A synthetic biography for layout verification.'), qualifications: [], representativeProjects: [], projectRole: text('负责需求确认', 'Responsible for requirements confirmation'), reportsToAssetId: null, caseAssetIds: [], photo: null } :
            kind === 'case' ? { kind, project: text('合成办公项目 A', 'Synthetic office project A'), city: en ? 'Test city' : '测试城市', submarket: null, propertyType: en ? 'Office' : '办公', serviceType: en ? 'Synthetic service' : '合成服务', clientIndustry: en ? 'Example industry' : '示例行业', clientType: en ? 'Example organization' : '示例企业', scale: { value: 1200, unit: 'm²' }, background: text('合成项目需求', 'Synthetic requirements'), challenge: text('确认项目条件', 'Confirm project conditions'), strategy: text('逐项比较候选方案', 'Compare the available options'), process: text('确认范围并核对资料', 'Confirm scope and verify evidence'), outcome: text('未提供真实业绩', 'No real performance claim'), occurredOn: date, buildingId: null, teamAssetIds: [], photos: [], disclosureMode: 'named', internalClientName: null, displayApproved: true, display: { ...base, title: en ? 'Synthetic office case' : '合成办公案例', blocks: [{ kind: 'case', title: en ? 'Synthetic office project A' : '合成办公项目 A', challenge: en ? 'Confirm project conditions' : '确认项目条件', approach: en ? 'Compare options against agreed requirements' : '按约定需求比较候选方案', outcome: en ? 'No real business outcome is asserted' : '此处不主张任何真实业务成果', sourceIds: refs }] } } :
                kind === 'research' ? { kind, topic: 'office-market', evidenceType: 'historical-view', methodology: text('合成历史样本；不代表当前市场。', 'Synthetic historical samples; not current market evidence.'), content: { ...base, blocks: [{ kind: 'chart', chartType: 'line', categories: ['2025-Q4', '2026-Q1'], series: [{ name: en ? 'Synthetic rent' : '合成租金', values: [100, 110], unit: 'RMB/m²/month' }], sourceIds: refs }, { kind: 'insight', claim: en ? 'The synthetic series increases.' : '合成序列呈现上升。', basis: en ? 'Two synthetic observations' : '两条合成观测记录', limitations: [en ? 'No current market inference' : '不推断当前市场'], sourceIds: refs }] } } :
                    { kind: 'custom', typeCode: id, content };
    if (profile.kind === 'case')
        Object.assign(profile, { briefDisplay: profile.display });
    const asset: BusinessAsset = { id: sourceId, version: 1, scope: { organizationId: 'synthetic', region: 'test', city: 'test', businessLine: 'test' }, profile: businessProfileSchema.parse(profile), content };
    const multiple = ['team-multiple', 'team-core', 'team-roles', 'team-organization', 'case-portfolio'].includes(id);
    const assets = multiple ? Array.from({ length: 3 }, (_, i) => ({ ...asset, profile: asset.profile.kind === 'team' ? { ...asset.profile, name: text('测试成员 ' + String.fromCharCode(65 + i), 'Test member ' + String.fromCharCode(65 + i)) } : asset.profile })) : [asset];
    return buildBusinessPages({ ...recipe, revision: 1, categoryId: sourceId, enabled: true }, assets, language, 'brief', 'standard');
}
