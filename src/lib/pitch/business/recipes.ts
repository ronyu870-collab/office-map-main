import { ECOSYSTEM_TEMPLATES } from '../templates/ecosystem';
import type { BusinessRecipe } from './protocol';
type Seed = Omit<BusinessRecipe, 'revision'|'categoryId'|'enabled'>;
export const LEGACY_BUSINESS_RECIPES: Seed[] = [
  ['corporate-overview','公司概览','Corporate overview','corporate','overview','two-columns',1],
  ['corporate-metrics','公司核心指标','Corporate metrics','corporate','metrics','kpi',1],
  ['corporate-capabilities','业务能力','Capabilities','corporate','capabilities','two-columns',1],
  ['team-single','单人介绍','Member profile','team','team','team-profile',1],
  ['team-multiple','多人团队','Team profiles','team','team','team-profile',30],
  ['team-core','核心团队','Core team','team','team','team-profile',12],
  ['team-roles','项目人员分工','Project roles','team','roles','data-table',30],
  ['team-organization','团队组织结构','Team organization','team','organization','data-table',30],
  ['case-detail','案例详细页','Detailed case study','case','case-detail','case-study',1],
  ['case-brief','案例精简页','Brief case study','case','case-brief','case-study',1],
  ['case-portfolio','多案例组合','Case portfolio','case','case-portfolio','case-study',20],
  ['case-track-record','历史业绩汇总','Track record','case','track-record','data-table',30],
  ['case-public-projects','可公开项目展示','Disclosed projects','case','public-projects','data-table',30],
  ['research-page','研究观点与资料','Research evidence','research','research','two-columns',10],
  ['custom-content','自定义内容板块','Custom content','custom','content','two-columns',10],
].map(([id,zh,en,kind,strategy,layoutId,maxAssets]) => ({ id, names:{zh,en}, description:`${zh}；保留经确认的事实、来源与业务日期。`, accepts:[kind], strategy,layoutId,maxAssets })) as Seed[];
export const BUSINESS_RECIPES: Seed[] = [...LEGACY_BUSINESS_RECIPES, ...ECOSYSTEM_TEMPLATES.map(t=>({id:t.id,names:t.names,description:t.description,accepts:['custom'] as ['custom'],strategy:'content' as const,layoutId:t.patternId,maxAssets:1}))];

export const DYNAMIC_CAPABILITIES = [
  ['building-profile','项目概况','available','可信楼宇目录与楼书参数；位置仅限已核验字段，照片可组合正式素材'],
  ['project-comparison','竞争项目横向对比','available','同一正式季度；自选获权参数'],
  ['rent-comparison','竞争项目租金对比','available','净有效租金；同季度，缺失与零值分开'],
  ['vacancy-comparison','竞争项目空置率对比','available','同一有效面积口径，缺失不作零'],
  ['rent-trend','市场租金历史趋势','available','连续季度，按有效总面积加权净有效租金'],
  ['vacancy-trend','市场空置率历史趋势','available','连续季度，同有效记录空置面积／总面积'],
  ['building-submarket','项目与子市场表现','available','项目与获权子市场采用同一季度和方法'],
  ['lease-representatives','近期代表性租赁成交','available','独立成交权限；确定性按面积排序，并非主观推荐'],
  ['lease-area-distribution','成交面积区间分布','unavailable','现有可信成交查询未提供面积区间分组接口；不另建冲突计算'],
  ['lease-industry-distribution','成交行业分布','available','独立成交权限；笔数或面积、缺失行业及有效样本分别保留'],
  ['competition-map','竞争项目分布地图','unavailable','尚无 Pitch 对客地图素材授权与统一坐标披露适配器'],
  ['stacking-plan','Stacking Plan','unavailable','保留原有入口权限；尚无获批 Pitch 导出适配器'],
].map(([id,name,status,reason])=>({id,name,status,reason,export:'internal-only'}));
