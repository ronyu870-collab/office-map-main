import { PROTOCOL, slideContentSchema, type SlideContent } from '../contracts/content';
import { patternFixture } from './patterns';
import type { LayoutId } from '../contracts/scene';
/** Isolated synthetic fixtures, never a real Colliers case or query response. */
export function layoutFixture(id: LayoutId, language: 'zh' | 'en' = 'zh', sourceId = '55555555-5555-4555-8555-555555555555', mediaId = '66666666-6666-4666-8666-666666666666'): SlideContent {
  const expanded=patternFixture(id,language,sourceId,mediaId);
  if(expanded)return slideContentSchema.parse(expanded);
  const en = language === 'en', refs = { sourceIds: [sourceId] }, image = { kind: 'image' as const, mediaAssetId: mediaId, mediaVersion: 1, alt: en ? 'Synthetic office illustration' : '合成办公空间示意图', ...refs };
  const paragraph = (zh: string, english: string) => ({ kind: 'paragraph' as const, text: en ? english : zh, ...refs });
  const insight = { kind: 'insight' as const, claim: en ? 'Compare periods on the same basis.' : '以相同口径观察期间变化。', basis: en ? 'Synthetic sample, consistent unit.' : '合成样本，单位与范围保持一致。', limitations: [en ? 'Illustration only; no investment advice.' : '仅为测试示意，不代表投资判断。'], ...refs };
  const byId: Record<LayoutId, { title: string; blocks: SlideContent['blocks'] }> = {
    cover: { title: en ? 'Workplace advisory | Test proposal' : '办公空间咨询｜测试提案', blocks: [paragraph('合成内容，用于验证专业提案的页面秩序。', 'Synthetic content to validate the proposal design system.'), image] },
    'section-divider': { title: en ? '01 | Understand the opportunity' : '01｜理解业务机会', blocks: [paragraph('统一数据期间与业务边界，为后续分析建立共同起点。', 'Align the reporting period and business scope before analysis.')] },
    'image-text': { title: en ? 'A coherent workplace story' : '清晰连贯的办公空间叙事', blocks: [paragraph('空间需求从业务目标出发。\n以可追溯内容、明确的数据时间和一致的视觉网格组织信息。\n本页全部素材为合成测试数据。', 'Start with business goals.\nUse traceable content, explicit reporting dates and a consistent visual grid.\nAll material on this page is synthetic test data.'), image] },
    'two-columns': { title: en ? 'Business priorities and delivery' : '业务重点与交付路径', blocks: [paragraph('业务重点\n明确客户需要解决的问题、时间边界与关键假设。保留未知，不用零值填补。', 'Business priorities\nDefine the decision, timing and assumptions. Preserve unknown values.'), paragraph('交付路径\n使用一致的来源与单位，建立可复用的页面组件，并记录版本。', 'Delivery\nUse consistent sources and units, reusable components and recorded versions.')] },
    kpi: { title: en ? 'Key indicators | Synthetic sample' : '核心指标｜合成样本', blocks: [
      { kind: 'metric', label: en ? 'Sample area' : '样本面积', value: 24000, unit: 'm²', yoy: 3.2, qoq: null, ...refs },
      { kind: 'metric', label: en ? 'Occupancy' : '使用率', value: 82, unit: '%', yoy: -1.5, ...refs },
      { kind: 'metric', label: en ? 'Unknown value' : '未确认数值', value: null, unit: '%', ...refs },
    ] },
    'team-profile': { title: en ? 'A coordinated team' : '协作团队', blocks: [{ kind: 'team', members: ['A', 'B', 'C'].map((v, i) => ({ name: en ? `Test Member ${v}` : `测试成员 ${v}`, title: en ? ['Advisory', 'Research', 'Delivery'][i] : ['咨询', '研究', '交付'][i], biography: en ? 'Synthetic profile for layout validation.' : '合成人物资料，仅验证布局与照片比例。', ...(i !== 2 ? { mediaAssetId: mediaId, mediaVersion: 1 } : {}) })), ...refs }] },
    'case-study': { title: en ? 'Case study | Synthetic example' : '案例研究｜合成示例', blocks: [{ kind: 'case', title: en ? 'A test workplace programme' : '测试办公空间计划', challenge: en ? 'Align several business needs.' : '协调不同业务需求。', approach: en ? 'Use consistent evidence and decision criteria.' : '统一证据来源和决策标准。', outcome: en ? 'A traceable proposal; no real client result.' : '形成可追溯提案，不代表真实客户成果。', ...refs }, image] },
    'data-table': { title: en ? 'Period data and unknowns' : '期间数据与未知值', blocks: [{ kind: 'table', columns: en ? ['Period', 'Area (m²)', 'Rate (%)'] : ['期间', '面积（m²）', '比例（%）'], rows: [['2026 Q1', 1000, 5], ['2026 Q2', 0, null], ['2026 Q3', 1200, 6.5]], ...refs }] },
    'chart-insight': { title: en ? 'Trend and analytical limits' : '趋势与分析边界', blocks: [{ kind: 'chart', chartType: 'line', categories: ['Q1', 'Q2', 'Q3', 'Q4'], series: [{ name: en ? 'Sample A' : '样本 A', values: [100, null, 120, 118], unit: 'RMB/m²' }], ...refs }, insight] },
    comparison: { title: en ? 'A consistent comparison' : '同口径项目对比', blocks: [{ kind: 'table', columns: en ? ['Project', 'Area (m²)', 'Term (yr)'] : ['项目', '面积（m²）', '年限（年）'], rows: [[en ? 'Test A' : '测试 A', 1000, 3], [en ? 'Test B' : '测试 B', 1500, 5], [en ? 'Test C' : '测试 C', null, 3]], ...refs }] },
    'map-analysis': { title: en ? 'Locations and context' : '区位与业务背景', blocks: [{ kind: 'map', mapId: 'synthetic-coordinate-map', snapshotVersion: '1', buildingIds: [], bounds: [116.3, 39.8, 116.6, 40.05], points: [{ label: en ? 'Test location A' : '测试点 A', longitude: 116.38, latitude: 39.92 }, { label: en ? 'Test location B' : '测试点 B', longitude: 116.5, latitude: 39.98 }], ...refs }, insight] },
    'strategy-framework': { title: en ? 'A practical delivery framework' : '可执行的交付框架', blocks: [{ kind: 'timeline', entries: ['01', '02', '03'].map((v, i) => ({ date: `2026-0${i + 1}-01`, title: en ? ['Define', 'Evaluate', 'Deliver'][i] : ['明确问题', '评估选项', '组织交付'][i], description: en ? 'Maintain explicit scope, evidence and accountable actions.' : '保持明确范围、可追溯证据与责任动作。' })), ...refs }] },
  };
  if(!byId[id])throw new Error('PITCH_LAYOUT_UNAVAILABLE');
  return slideContentSchema.parse({ protocol: PROTOCOL, locale: language, title: byId[id].title, blocks: byId[id].blocks,
    sources: [{ id: sourceId, kind: 'synthetic', label: en ? 'Synthetic test material' : '合成测试素材', locator: `fixture:${id}`, version: '2', dataAsOf: '2026-01-01' }],
    dataAsOf: '2026-01-01', disclosure: 'internal', isTestData: true });
}
