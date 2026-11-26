import { PROTOCOL, slideContentSchema, type SlideContent } from '../contracts/content';

const sourceId = '55555555-5555-4555-8555-555555555555';
const sourceIds = [sourceId];
const date = '2026-09-30';
const paragraph = (text: string) => ({ kind: 'paragraph' as const, text, sourceIds });
type Chart = Extract<SlideContent['blocks'][number], { kind: 'chart' }>;

export const fixtureImages = [
  [1300, 1780, '霄云路样稿外立面', .57, .38],
  [1800, 1150, '街道与主入口', .52, .49],
  [1150, 1550, '示例 A', .51, .39],
  [1150, 1550, '示例 B', .58, .40],
  [1150, 1550, '示例 C', .43, .40],
  [1150, 1550, '示例 D', .54, .44],
  [1150, 1550, '示例 E', .47, .48],
  [1920, 1200, '建筑立面与街道界面', .44, .34],
  [1150, 1550, '立面细部', .46, .44],
] as const;

export function fixtureMediaId(index: number) {
  return '66000000-0000-4000-8000-' + (index + 1).toString().padStart(12, '0');
}
function image(index: number) {
  const [width, height, caption, x, y] = fixtureImages[index];
  return { kind: 'image' as const, mediaAssetId: fixtureMediaId(index), mediaVersion: 1,
    aspectRatio: width / height, focus: { x, y }, alt: caption, caption, credit: '合成插图', sourceIds };
}
function page(title: string, blocks: SlideContent['blocks'], subtitle?: string, locale = 'zh') {
  return slideContentSchema.parse({
    protocol: PROTOCOL, locale, title, subtitle, blocks,
    dataAsOf: date, isTestData: true, disclosure: 'internal',
    sources: [{ id: sourceId, kind: 'synthetic', label: locale === 'en' ? 'Pitch Studio design fixture' : 'Pitch Studio 构图样稿',
      locator: 'local:design-fixtures', version: '1', dataAsOf: date }],
  });
}
function chart(presentation: Omit<Chart, 'kind' | 'sourceIds'>): Chart { return { kind: 'chart', sourceIds, ...presentation }; }
const quarters = ['2025 Q3', '2025 Q4', '2026 Q1', '2026 Q2', '2026 Q3'];
const peerLabels = ['示例 A', '示例 B', '示例 C', '示例 D', '示例 E'];

export const designDemos = [
  {
    id: 'owner-advisory', theme: 0, title: '霄云路33号｜业主招商代理',
    pages: [
      { layout: 'cover', content: page('霄云路33号\n招商代理提案', [image(0)], '业主委托与上市策略｜构图样稿') },
      { layout: 'image-text', content: page('先明确楼宇定位，再组织招商节奏', [
        paragraph('以楼层条件和承租面积划分客群。首轮走访围绕看楼动线、交付条件和可拆分性，形成统一的对外口径。'),
        paragraph('每周复盘有效带看、意向进度和竞品动态，按反馈调整租赁条件和市场沟通。'), image(1),
      ]) },
      { layout: 'chart-insight', content: page('竞品报价与市场基准', [
        chart({ chartType: 'combo', categories: peerLabels, series: [
          { name: '样本报价', unit: '元/㎡/天', values: [7.1, 6.3, 6.7, 7.4, 6.5] },
          { name: '市场基准', unit: '元/㎡/天', values: [6.8, 6.8, 6.8, 6.8, 6.8] },
        ], emphasis: { kind: 'benchmark' } }),
        { kind: 'insight', claim: '报价讨论统一采用同一单位。', basis: '基准线贯穿全部样本，便于比较偏离程度。', limitations: ['示意数据不用于议价。'], sourceIds },
      ]) },
      { layout: 'decision-next-steps', content: page('启动前确认三项工作', [
        paragraph('确认拟委托范围、对外租赁口径和阶段性复盘机制。每项工作以可核对的交付物收尾。'),
        { kind: 'timeline', entries: [
          { date: '2026-10-08', title: '确认授权', description: '核对代理范围与披露权限。' },
          { date: '2026-10-15', title: '统一资料', description: '确认交付条件、报价口径与楼层参数。' },
          { date: '2026-10-22', title: '启动首轮', description: '完成目标客户触达与周度复盘。' },
        ], sourceIds },
      ]) },
    ],
  },
  {
    id: 'cbd-five-assets', theme: 5, title: 'CBD五楼宇｜横向比较',
    pages: [
      { layout: 'photo-gallery', content: page('CBD 五栋楼宇外观对照', [2, 3, 4, 5, 6].map(image)) },
      { layout: 'comparison', content: page('用同一口径比较楼宇条件', [{ kind: 'table', columns: ['项目', '租金（元/㎡/天）', '空置率（%）', '整层（㎡）'], rows: [
        ['示例 A', 6.1, 12.4, 1980], ['示例 B', 6.7, 8.3, 2020], ['示例 C', 7.2, 14.9, null],
        ['示例 D', 7.6, 10.5, 2200], ['示例 E', 8.1, 16.5, 2300],
      ], sourceIds }]) },
      { layout: 'chart-insight', content: page('租金与空置率的项目定位', [
        chart({ chartType: 'scatter', categories: peerLabels, xAxis: { label: '报价租金', unit: '元/㎡/天', values: [6.1, 6.7, 7.2, 7.6, 8.1] },
          series: [{ name: '空置率', values: [12.4, 8.3, 14.9, 10.5, 16.5], unit: '%' }], emphasis: { kind: 'target', category: 2 } }),
      ]) },
      { layout: 'map-analysis', content: page('区位关系与实地核查顺序', [
        { kind: 'map', mapId: 'synthetic-cbd', snapshotVersion: '1', buildingIds: [], bounds: [116.42, 39.89, 116.49, 39.95],
          points: peerLabels.map((label, i) => ({ label, longitude: 116.428 + i * .012, latitude: 39.898 + (i * .017) % .044 })), sourceIds },
        { kind: 'insight', claim: '工作日分两组踏勘。', basis: '各组先看相邻样本，记录步行和车辆到达条件。', limitations: ['坐标为合成示意。'], sourceIds },
      ]) },
    ],
  },
  {
    id: 'beijing-quarter', theme: 3, title: '北京写字楼｜季度研究',
    pages: [
      { layout: 'cover', content: page('北京写字楼季度研究', [paragraph('租赁表现、分区比较与成交结构')], '2026年第三季度｜研究构图样稿') },
      { layout: 'chart-insight', content: page('季度走势按同一租金口径比较', [
        chart({ chartType: 'line', categories: quarters, series: [
          { name: '核心区', unit: '元/㎡/月', values: [267, 261, 255, 251, 248] },
          { name: '全市样本', unit: '元/㎡/月', values: [229, 227, 223, 217, 216] },
        ] }),
      ]) },
      { layout: 'data-table', content: page('子市场空置率对照', [{ kind: 'table', treatment: 'heatmap', columns: ['子市场', ...quarters], rows: [
        ['核心商务区', 14.4, 14.0, 13.6, 13.5, 13.1], ['西部商务区', 9.3, 10.0, 9.7, null, 9.8],
        ['北部商务区', 17.2, 17.3, 17.6, 18.1, 18.8], ['东部商务区', 13.4, 13.6, 13.6, 13.4, 13.3],
        ['南部商务区', 22.4, 20.0, 20.2, 19.8, 19.1],
      ], sourceIds }], '空置率（%）｜深色表示同一尺度上较高的值') },
      { layout: 'chart-insight', content: page('按面积区间观察成交结构', [
        chart({ chartType: 'stacked-column', categories: ['<500㎡', '500–999㎡', '1,000–1,999㎡', '≥2,000㎡'], series: [
          { name: '新租', unit: '宗', values: [18, 16, 9, 5] }, { name: '扩租', unit: '宗', values: [7, 5, 5, 2] },
        ] }),
      ]) },
    ],
  },
  {
    id: 'single-building', theme: 2, title: '单楼宇推介｜建筑作品集',
    pages: [
      { layout: 'cover', content: page('地标办公楼\nLandmark Offices', [image(7)], '建筑、到达与空间｜构图样稿') },
      { layout: 'photo-kpi', content: page('建筑参数与整层尺度', [
        image(8),
        { kind: 'metric', label: '标准整层面积', value: 2100, unit: '㎡', sourceIds },
        { kind: 'metric', label: '标准层净高', value: 2.9, unit: 'm', sourceIds },
        { kind: 'metric', label: '可出租楼层', value: 18, unit: '层', sourceIds },
      ]) },
      { layout: 'image-text', content: page('Street address and building arrival', [
        paragraph('The façade, entrance and street frontage support three scales of inspection in one image.'),
        paragraph('Review pedestrian access and lobby approach during the site visit.'), image(1),
      ], undefined, 'en') },
      { layout: 'section-divider', content: page('下一步｜预约现场踏勘', [paragraph('用同一路线核查到达动线、大堂、标准层与可交付空间。')]) },
    ],
  },
] as const;

export function designComparisonCover() {
  return page('City offices\n城市办公空间', [image(7)], 'Architecture and occupier advisory', 'en');
}
