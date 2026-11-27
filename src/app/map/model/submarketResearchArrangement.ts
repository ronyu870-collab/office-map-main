import { normalizeMapSubmarket } from './marketIdentity';
import type { MarketBuilding } from './marketStatistics';
import type { SubmarketTrendPoint } from './submarketMarketTrend';
import { MIN_RESEARCH_MARKET_SAMPLES } from './submarketMarketTrend';
import type { ResearchTheme } from './submarketResearchPresentation';

export const researchFullModules = ['trend', 'composition', 'profile', 'projects', 'analysis', 'outlook'] as const;
export type ResearchFullModule = typeof researchFullModules[number];
export const researchAnalysisModules = ['product', 'distribution', 'scatter', 'context', 'demand', 'supply'] as const;
export type ResearchAnalysisModule = typeof researchAnalysisModules[number];
export type ResearchOverviewModule = 'composition' | 'projects' | 'analysis';
export interface ResearchProjectReference {
  buildingId: string;
  role: string;
  reason: string;
}
interface CatalogReference extends ResearchProjectReference {
  grade: string;
}
export interface MarketResearchArrangement {
  benchmark?: boolean;
  projectFirst?: boolean;
  leadTitle?: string;
  leadTheme?: ResearchTheme;
  positioning?: readonly [string, string];
  themeOrder: readonly ResearchTheme[];
  chapterTitles?: Partial<Record<ResearchTheme, string>>;
  observationThemes?: Readonly<Record<string, ResearchTheme>>;
  full: readonly ResearchFullModule[];
  overview: readonly ResearchOverviewModule[];
  analysis: readonly ResearchAnalysisModule[];
  analysisTitle?: string;
  maxProjects: number;
  catalogReferences?: readonly CatalogReference[];
}

const benchmark = (themeOrder: readonly ResearchTheme[]): MarketResearchArrangement => ({
  benchmark: true, themeOrder, full: ['trend', 'composition', 'profile', 'projects', 'outlook'],
  overview: ['composition', 'projects'], analysis: researchAnalysisModules, maxProjects: 6,
});
const catalog = (buildingId: string, grade: string, role: string, reason: string): CatalogReference => ({ buildingId, grade, role, reason });

/** Editorial ordering only. Published research and formal facts remain the source of truth.
 * Positioning rewrites are conditional on the exact reviewed text; a later edition wins.
 * Catalog references are suggestions against the authorized current catalog, not published research.
 */
export const MARKET_RESEARCH_ARRANGEMENTS: Readonly<Record<string, MarketResearchArrangement>> = {
  CBD: benchmark(['competition', 'demand', 'location', 'outlook']),
  金融街: {
    leadTitle: '金融总部邻近价值具有行业针对性', leadTheme: 'demand',
    positioning: ['金融总部与资管机构密集的核心办公区；存量韧性与价格调整并存', '金融总部与资管机构密集的核心办公区'],
    themeOrder: ['demand', 'competition', 'location', 'outlook'],
    chapterTitles: { demand: '金融机构与总部办公', competition: '核心存量与租金梯度', location: '金融业务区位' },
    observationThemes: { '与丽泽的竞争取决于业务功能': 'location', '低空置不等于新增需求旺盛': 'competition' },
    full: ['profile', 'trend', 'analysis', 'composition', 'projects', 'outlook'], overview: ['composition', 'projects', 'analysis'],
    analysis: ['distribution', 'product', 'context', 'scatter'], analysisTitle: '金融办公租金梯度与产品比较', maxProjects: 4,
    catalogReferences: [
      catalog('1c822300-ac2c-4347-86df-4fb48d560ffe', 'P', '超甲级产品参照', '英蓝国际金融中心：用于比较核心区高等级办公产品。'),
      catalog('e54b4d84-7439-4941-99e9-e6b3b3050f44', 'A', '甲级产品参照', '凯晨世贸中心：与本区超甲级及乙级资产进行同口径选址比较。'),
      catalog('f58c5f3f-e768-468f-9c91-b3e7611ec056', 'B', '乙级产品参照', '鑫茂大厦：提供本区乙级办公选择。'),
    ],
  },
  中关村: {
    leadTitle: '前沿科技企业释放标准办公需求', leadTheme: 'demand',
    positioning: ['北京科技办公需求核心板块，2026Q3率先出现去化改善与租金回升', '北京科技办公需求核心板块'],
    themeOrder: ['demand', 'competition', 'location', 'outlook'],
    chapterTitles: { demand: '科技企业与创新办公', competition: '去化与办公价格梯度', location: '商务办公与研发分工' },
    observationThemes: { '科技需求驱动阶段性筑底': 'competition', '核心办公与专业研发载体具有分工': 'location' },
    full: ['profile', 'composition', 'analysis', 'trend', 'projects', 'outlook'], overview: ['composition', 'analysis', 'projects'],
    analysis: ['demand', 'product', 'distribution', 'context'], analysisTitle: '科技办公需求与产品结构', maxProjects: 4,
  },
  丽泽: {
    leadTitle: '去化改善伴随价格让渡', leadTheme: 'competition',
    positioning: ['新兴金融商务区进入实质去化阶段，大面积机构需求与租金竞争并存', '新兴金融商务区'],
    themeOrder: ['competition', 'demand', 'location', 'outlook'],
    chapterTitles: { competition: '供应兑现与存量去化', demand: '机构租赁需求', location: '商务区发展与交通' },
    full: ['analysis', 'trend', 'profile', 'composition', 'projects', 'outlook'], overview: ['analysis', 'projects', 'composition'],
    analysis: ['supply', 'demand', 'distribution', 'context'], analysisTitle: '供应兑现与去化比较', maxProjects: 4,
  },
  '望京-酒仙桥': benchmark(['competition', 'demand', 'location', 'outlook']),
  燕莎: {
    leadTitle: '使馆邻近和国际接待仍是差异化价值', leadTheme: 'location',
    positioning: ['涉外商务和酒店服务构成区位差异，成熟存量办公面临退租与升级竞争', '涉外商务和酒店服务构成区位差异'],
    themeOrder: ['location', 'competition', 'demand', 'outlook'],
    chapterTitles: { location: '国际商务与接待区位', competition: '成熟存量与品质竞争' },
    full: ['profile', 'projects', 'composition', 'trend', 'analysis', 'outlook'], overview: ['projects', 'composition', 'analysis'],
    analysis: ['context', 'distribution', 'product', 'demand'], analysisTitle: '成熟商务楼宇与价格带', maxProjects: 4,
    catalogReferences: [
      catalog('072d0b17-f3eb-4690-9673-8286c858b7c0', 'P', '超甲级产品参照', '启皓北京：用于比较本区高等级办公选择。'),
      catalog('27592e3a-c83b-4d21-8d1b-d175ff9a9678', 'A', '甲级产品参照', '佳程广场：本区甲级办公产品参照。'),
      catalog('a4cda930-526e-4a49-81c1-4f14458986a9', 'B', '乙级产品参照', '二十一世纪大厦：提供另一等级的成本比较参照。'),
    ],
  },
  亚奥: {
    leadTitle: '国际机构与会展构成特色商务场景', leadTheme: 'location',
    positioning: ['北部总部办公与国际机构节点，科技需求改善去化而项目空置压力仍存在', '北部总部办公与国际机构节点'],
    themeOrder: ['location', 'demand', 'competition', 'outlook'],
    chapterTitles: { location: '会展与商务区位', competition: '办公等级与存量表现' },
    full: ['composition', 'profile', 'projects', 'trend', 'analysis', 'outlook'], overview: ['composition', 'projects', 'analysis'],
    analysis: ['product', 'context', 'distribution'], analysisTitle: '等级结构与商务资产比较', maxProjects: 4,
  },
  东城商务区: {
    leadTitle: '存量办公具有中心城区替代价值', leadTheme: 'competition',
    positioning: ['东二环成熟总部走廊，存量退租与楼宇调整带来价格竞争', '东二环成熟商务办公走廊'],
    themeOrder: ['location', 'competition', 'demand', 'outlook'],
    chapterTitles: { location: '中心城区商务区位', competition: '存量办公的产品差异' },
    full: ['projects', 'profile', 'composition', 'analysis', 'trend', 'outlook'], overview: ['projects', 'analysis', 'composition'],
    analysis: ['context', 'product', 'distribution'], analysisTitle: '中心城区资产与产品比较', maxProjects: 4,
    catalogReferences: [
      catalog('c3a22c0d-d654-408a-bd77-609ee4eb9193', 'P', '超甲级产品参照', '信达中心：本区高等级办公选择。'),
      catalog('334cbbeb-ab66-4233-b4e2-8e1f927df843', 'A', '东二环甲级参照', '五矿广场：东二环办公产品参照。'),
      catalog('6e996a64-7a22-4cd6-b435-1e0433555c99', 'A', '甲级产品参照', '东方广场东区：提供另一处中心城区甲级资产选择。'),
      catalog('4274a135-37c4-4276-bb7b-698e57b11268', 'B', '乙级产品参照', '富华大厦：用于比较乙级办公成本。'),
    ],
  },
  玉渊潭: {
    projectFirst: true, leadTitle: '西部成熟交通节点，不是大型总部供给集群', leadTheme: 'location',
    positioning: ['复兴路—公主坟西部成熟办公节点，项目差异比区域均值更有解释力', '复兴路—公主坟西部成熟办公节点'],
    themeOrder: ['location', 'competition', 'demand', 'outlook'],
    chapterTitles: { location: '西部办公区位', competition: '项目级选址比较' },
    full: ['projects', 'profile', 'analysis', 'trend', 'outlook'], overview: ['projects', 'analysis'],
    analysis: ['context', 'distribution', 'supply'], analysisTitle: '具体资产与选址条件', maxProjects: 1,
    catalogReferences: [catalog('59f20a3a-4fc8-40d2-8270-f6a5c9784bee', 'B', '正式观测项目', '裕阜商务中心：以该项目自身正式季度观测为参照，不代表区域平均水平。')],
  },
  通州: {
    leadTitle: '机构迁址成为明确去化动力', leadTheme: 'demand',
    positioning: ['副中心运河商务区实际机构租赁去化改善，供给兑现与持续市场化需求决定长期平衡', '副中心运河商务区办公市场'],
    themeOrder: ['demand', 'competition', 'location', 'outlook'],
    chapterTitles: { demand: '机构租赁与实际去化', competition: '供应兑现及后续竞争', location: '副中心区位与交通' },
    full: ['analysis', 'profile', 'trend', 'composition', 'projects', 'outlook'], overview: ['analysis', 'composition', 'projects'],
    analysis: ['supply', 'demand', 'context', 'distribution'], analysisTitle: '副中心供应与租赁去化', maxProjects: 4,
  },
  上地: benchmark(['demand', 'competition', 'location', 'outlook']),
  北清路: {
    leadTitle: '专业研发需要按用途而不是普通办公划分', leadTheme: 'demand',
    positioning: ['海淀北部硬科技研发载体集中，产业需求与集中供应压力并存', '海淀北部硬科技研发载体集中'],
    themeOrder: ['demand', 'competition', 'location', 'outlook'],
    chapterTitles: { demand: '硬科技与专业研发空间', competition: '园区供应与价格压力' },
    full: ['profile', 'analysis', 'composition', 'projects', 'trend', 'outlook'], overview: ['analysis', 'projects', 'composition'],
    analysis: ['supply', 'context', 'distribution', 'demand'], analysisTitle: '研发园区与集中供应', maxProjects: 4,
  },
  四季青: {
    projectFirst: true, leadTitle: '市场价值来自特色项目而非统一办公大盘', leadTheme: 'competition',
    positioning: ['海淀西部特色科创与更新园区，以具体产业服务和空间形态形成差异', '海淀西部特色科创与更新园区'],
    themeOrder: ['competition', 'location', 'demand', 'outlook'],
    chapterTitles: { competition: '特色园区与更新项目', location: '海淀西部选址条件' },
    full: ['projects', 'profile', 'analysis', 'trend', 'outlook'], overview: ['projects', 'analysis'],
    analysis: ['context', 'supply', 'distribution'], analysisTitle: '园区项目与供应参照', maxProjects: 2,
  },
  丰台科技园: {
    leadTitle: '工程技术产业协作是选址的核心价值', leadTheme: 'demand',
    positioning: ['西南轨道交通与通信技术研发产业集聚区，产业协作区别于丽泽金融办公', '西南轨道交通与通信技术研发产业集聚区'],
    themeOrder: ['demand', 'location', 'competition', 'outlook'],
    chapterTitles: { demand: '工程技术产业协作', competition: '园区办公成本与产品' },
    full: ['profile', 'composition', 'projects', 'trend', 'analysis', 'outlook'], overview: ['projects', 'composition', 'analysis'],
    analysis: ['context', 'distribution', 'demand'], analysisTitle: '工程技术园区与办公成本', maxProjects: 3,
  },
  亦庄: {
    leadTitle: '研发平台与制造场景构成区位优势', leadTheme: 'demand',
    positioning: ['先进制造与半导体产业链拉动园区需求，研发、商务办公和生产协同形成分层', '先进制造产业链与研发办公协同的园区市场'],
    themeOrder: ['demand', 'competition', 'location', 'outlook'],
    chapterTitles: { demand: '先进制造与研发协作', competition: '园区产品与供给', location: '研发平台与区位' },
    full: ['composition', 'profile', 'analysis', 'projects', 'trend', 'outlook'], overview: ['composition', 'analysis', 'projects'],
    analysis: ['product', 'supply', 'context', 'distribution'], analysisTitle: '研发办公产品与园区供应', maxProjects: 4,
  },
  通惠河传媒走廊: {
    leadTitle: '内容制作空间存在独立的租赁需求逻辑', leadTheme: 'demand',
    positioning: ['CBD东向传媒及数字内容园区，特色制作与展示空间和总部商务形成互补', 'CBD东向传媒及数字内容园区'],
    themeOrder: ['demand', 'competition', 'location', 'outlook'],
    chapterTitles: { demand: '传媒制作与创意办公', competition: '更新型产品与租赁选择' },
    full: ['projects', 'profile', 'composition', 'analysis', 'trend', 'outlook'], overview: ['projects', 'analysis', 'composition'],
    analysis: ['context', 'demand', 'distribution'], analysisTitle: '创意载体与实际租赁选择', maxProjects: 4,
  },
};

export function marketResearchArrangement(name: string): MarketResearchArrangement | undefined {
  const key = normalizeMapSubmarket(name);
  return Object.prototype.hasOwnProperty.call(MARKET_RESEARCH_ARRANGEMENTS, key) ? MARKET_RESEARCH_ARRANGEMENTS[key] : undefined;
}

export function visibleResearchFullModules(
  plan: MarketResearchArrangement, availability: Partial<Record<ResearchFullModule, boolean>>,
): ResearchFullModule[] {
  return plan.full.filter(module => availability[module] !== false);
}

/** A single observed asset is not regional research. For sparse markets require two
 * distinct quarters with representative observations of the same metric. */
export function hasRepresentativeResearchTrend(points: readonly SubmarketTrendPoint[], multiplePeriods = false): boolean {
  const rent = new Set<string>(), vacancy = new Set<string>();
  for (const point of points) {
    const period = String(point.year) + 'Q' + String(point.quarter);
    if (point.rentSamples >= MIN_RESEARCH_MARKET_SAMPLES && point.rent != null && Number.isFinite(point.rent)) rent.add(period);
    if (point.vacancySamples >= MIN_RESEARCH_MARKET_SAMPLES && point.vacancyPct != null && Number.isFinite(point.vacancyPct)) vacancy.add(period);
  }
  return Math.max(rent.size, vacancy.size) >= (multiplePeriods ? 2 : 1);
}

export function researchCatalogReferences(name: string, buildings: readonly MarketBuilding[]): ResearchProjectReference[] {
  const plan = marketResearchArrangement(name);
  if (!plan?.catalogReferences?.length) return [];
  const catalogById = new Map(buildings.map(building => [building.id, building]));
  return plan.catalogReferences.flatMap(({ buildingId, grade, role, reason }) => {
    const asset = catalogById.get(buildingId);
    if (!asset || normalizeMapSubmarket(asset.submarket ?? '') !== normalizeMapSubmarket(name) || asset.grade !== grade) return [];
    return [{ buildingId, role, reason }];
  });
}
