import type { LayoutId } from '../contracts/scene';
import type { SlideContent } from '../contracts/content';
type Block = SlideContent['blocks'][number];
export const LAYOUTS: { id: LayoutId; zh: string; en: string; kinds: Block['kind'][]; pagination: string }[] = [
  { id: 'cover', zh: '封面', en: 'Cover', kinds: ['paragraph', 'image'], pagination: '正文超限时拒绝；可选配图' },
  { id: 'section-divider', zh: '章节过渡', en: 'Section Divider', kinds: ['paragraph'], pagination: '章节说明超限时拒绝' },
  { id: 'image-text', zh: '单图文', en: 'Image & Text', kinds: ['paragraph', 'image'], pagination: '正文按实测行高分页，重复配图' },
  { id: 'two-columns', zh: '双栏内容', en: 'Two Columns', kinds: ['paragraph'], pagination: '按栏高连续分页' },
  { id: 'kpi', zh: '核心指标', en: 'KPI', kinds: ['metric'], pagination: '每页最多六项，长说明明确拒绝' },
  { id: 'team-profile', zh: '团队成员', en: 'Team Profile', kinds: ['team'], pagination: '每页两人／三人；缺照片保留文字说明' },
  { id: 'case-study', zh: '案例研究', en: 'Case Study', kinds: ['case', 'image'], pagination: '挑战、方法、成果分组连续分页' },
  { id: 'data-table', zh: '数据表格', en: 'Data Table', kinds: ['table'], pagination: '按每行实测高度分页并重复表头' },
  { id: 'chart-insight', zh: '图表与分析', en: 'Chart & Insight', kinds: ['chart', 'insight'], pagination: '最多十二标签／四系列；分析按行分页' },
  { id: 'comparison', zh: '多项目对比', en: 'Comparison', kinds: ['table'], pagination: '指标行与项目列对比，按行高分页；可切换普通矩阵' },
  { id: 'map-analysis', zh: '地图分析', en: 'Map & Analysis', kinds: ['map', 'insight'], pagination: '固定地理范围；最多十二点，拥挤时拒绝' },
  { id: 'strategy-framework', zh: '策略框架', en: 'Strategy Framework', kinds: ['timeline'], pagination: '每页三个流程节点，保留日期与说明' },
];
