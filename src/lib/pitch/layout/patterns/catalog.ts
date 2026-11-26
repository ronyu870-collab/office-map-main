/** Reviewed structure-only compositions. No executable configuration, colors,
 * fonts, URLs or business facts. Units are fractions of the content safe zone.
 * Modified/adapted from the licensed sources recorded in template-sources.md.
 */
export type SlotKind = 'paragraph' | 'image' | 'metric' | 'table' | 'chart' | 'team' | 'case' | 'timeline';
export type PatternSlot = {
    kind: SlotKind;
    x: number;
    y: number;
    w: number;
    h: number;
};
export type PatternMark = {
    shape: 'rect' | 'ellipse' | 'arrow' | 'triangle' | 'trapezoid';
    x: number;
    y: number;
    w: number;
    h: number;
    tone: 'primary' | 'secondary' | 'background';
    opacity?: number;
};
export type LayoutPattern = {
    id: string;
    version: number;
    zh: string;
    en: string;
    source: 'mck' | 'slideforge' | 'pptmaster' | 'recipes' | 'colliers';
    slots: PatternSlot[];
    marks: PatternMark[];
    description: string;
};
const slot = (kind: SlotKind, x: number, y: number, w: number, h: number): PatternSlot => ({ kind, x, y, w, h });
const p = (x: number, y: number, w: number, h: number) => slot('paragraph', x, y, w, h);
const im = (x: number, y: number, w: number, h: number) => slot('image', x, y, w, h);
const metric = (x: number, y: number, w: number, h: number) => slot('metric', x, y, w, h);
const table = (x: number, y: number, w: number, h: number) => slot('table', x, y, w, h);
const chart = (x: number, y: number, w: number, h: number) => slot('chart', x, y, w, h);
const mark = (shape: PatternMark['shape'], x: number, y: number, w: number, h: number, tone: PatternMark['tone'] = 'secondary', opacity = .14): PatternMark => ({ shape, x, y, w, h, tone, opacity });
const pattern = (id: string, zh: string, en: string, source: LayoutPattern['source'], slots: PatternSlot[], marks: PatternMark[] = [], description = ''): LayoutPattern => ({ id, version: 2, zh, en, source, slots, marks, description: description || `${zh}；按插槽保留完整内容，超量分页，缺少必要内容明确拒绝。` });
/** Each entry has a different component arrangement/relationship. Mirroring,
 * recoloring and number of repeated items are not separate patterns. */
export const PATTERNS: readonly LayoutPattern[] = [
    pattern('executive-summary', '执行摘要', 'Executive summary', 'mck', [p(0, 0, 1, .2), p(0, .29, .3, .71), p(.35, .29, .3, .71), p(.7, .29, .3, .71)]),
    pattern('action-detail', '行动结论与论据', 'Action and evidence', 'mck', [p(0, 0, .25, 1), p(.32, 0, .68, .43), p(.32, .53, .68, .47)], [mark('rect', 0, 0, .27, 1)]),
    pattern('agenda-rail', '议程与导读', 'Agenda rail', 'slideforge', [p(.1, 0, .86, .26), p(.1, .36, .86, .26), p(.1, .72, .86, .28)], [mark('rect', 0, 0, .015, 1, 'primary')]),
    pattern('three-column-overview', '三栏概览', 'Three-column overview', 'pptmaster', [p(0, 0, .3, 1), p(.35, 0, .3, 1), p(.7, 0, .3, 1)]),
    pattern('quadrant-framework', '四象限框架', 'Quadrant framework', 'mck', [p(.03, .03, .43, .4), p(.54, .03, .43, .4), p(.03, .57, .43, .4), p(.54, .57, .43, .4)], [mark('rect', .495, 0, .005, 1), mark('rect', 0, .495, 1, .01)]),
    pattern('recommendation-panel', '建议清单与重点', 'Recommendations and priority', 'mck', [p(0, 0, .62, .28), p(0, .36, .62, .28), p(0, .72, .62, .28), p(.7, .08, .28, .84)], [mark('rect', .68, 0, .32, 1)]),
    pattern('quote-evidence', '观点与证据', 'Quote and evidence', 'mck', [p(.04, .08, .64, .68), p(.74, .1, .26, .9), p(.04, .84, .64, .16)], [mark('rect', 0, .08, .01, .68, 'primary')]),
    pattern('problem-solution', '问题与解决路径', 'Problem and solution', 'recipes', [p(0, 0, .4, .9), p(.6, 0, .4, .9)], [mark('arrow', .44, .38, .12, .15, 'primary')]),
    pattern('before-after', '现状与目标', 'Before and after', 'mck', [p(.03, .08, .4, .84), p(.57, .08, .4, .84)], [mark('rect', 0, 0, .46, 1), mark('arrow', .48, .4, .04, .13, 'primary'), mark('rect', .54, 0, .46, 1, 'primary', .06)]),
    pattern('pros-cons', '优势与约束', 'Advantages and constraints', 'mck', [p(.03, .04, .94, .39), p(.03, .57, .94, .39)], [mark('rect', 0, 0, .012, .47, 'primary'), mark('rect', 0, .53, .012, .47)]),
    pattern('strategy-house', '策略屋', 'Strategy house', 'mck', [p(.22, .06, .56, .16), p(.07, .34, .24, .37), p(.38, .34, .24, .37), p(.69, .34, .24, .37), p(.07, .85, .86, .15)], [mark('triangle', .01, 0, .98, .3), mark('rect', .04, .3, .3, .46), mark('rect', .35, .3, .3, .46), mark('rect', .66, .3, .3, .46), mark('rect', .02, .8, .96, .2)]),
    pattern('issue-tree', '问题分解树', 'Issue tree', 'mck', [p(.02, .37, .26, .26), p(.49, 0, .51, .26), p(.49, .37, .51, .26), p(.49, .74, .51, .26)], [mark('arrow', .32, .44, .12, .12), mark('rect', .45, .1, .005, .8)]),
    pattern('qualitative-funnel', '阶段漏斗', 'Qualitative funnel', 'mck', [p(.1, .04, .8, .2), p(.2, .39, .6, .2), p(.3, .74, .4, .2)], [mark('trapezoid', 0, 0, 1, .3), mark('trapezoid', .12, .35, .76, .3), mark('trapezoid', .24, .7, .52, .3)]),
    pattern('cycle-four', '四步循环', 'Four-step cycle', 'mck', [p(.3, 0, .4, .2), p(.69, .36, .31, .28), p(.3, .8, .4, .2), p(0, .36, .31, .28)], [mark('ellipse', .36, .31, .28, .38), mark('arrow', .71, .2, .08, .1), mark('arrow', .71, .71, .08, .1), mark('arrow', .18, .71, .08, .1), mark('arrow', .18, .2, .08, .1)]),
    pattern('process-chevron', '流程箭头', 'Process chevrons', 'mck', [p(.03, .12, .25, .22), p(.38, .12, .25, .22), p(.73, .12, .25, .22), p(.03, .55, .25, .45), p(.38, .55, .25, .45), p(.73, .55, .25, .45)], [mark('arrow', 0, 0, .3, .43), mark('arrow', .35, 0, .3, .43), mark('arrow', .7, 0, .3, .43)]),
    pattern('vertical-steps', '纵向步骤', 'Vertical steps', 'slideforge', [p(.1, 0, .57, .26), p(.1, .37, .57, .26), p(.1, .74, .57, .26), p(.76, 0, .24, 1)], [mark('rect', .025, 0, .01, 1), mark('ellipse', 0, .04, .06, .08), mark('ellipse', 0, .41, .06, .08), mark('ellipse', 0, .78, .06, .08)]),
    pattern('roadmap-lanes', '分轨路线图', 'Roadmap lanes', 'slideforge', [p(0, 0, .17, .27), p(.25, 0, .75, .27), p(0, .36, .17, .27), p(.4, .36, .6, .27), p(0, .72, .17, .27), p(.6, .72, .4, .27)], [mark('rect', .22, 0, .005, 1), mark('arrow', .23, .29, .77, .035), mark('arrow', .38, .65, .62, .035)]),
    pattern('staircase', '阶梯演进', 'Staircase evolution', 'mck', [p(.02, .69, .27, .25), p(.36, .38, .27, .25), p(.7, .07, .27, .25)], [mark('rect', 0, .65, .31, .35), mark('rect', .34, .34, .31, .66), mark('rect', .68, .03, .32, .97)]),
    pattern('value-chain', '价值链', 'Value chain', 'mck', [p(.015, .1, .17, .38), p(.22, .1, .17, .38), p(.425, .1, .17, .38), p(.63, .1, .17, .38), p(.835, .1, .16, .38), p(0, .72, 1, .28)], [mark('arrow', 0, 0, 1, .62)]),
    pattern('timeline-alternating', '交错时间轴', 'Alternating timeline', 'mck', [slot('timeline', 0, 0, 1, 1)]),
    pattern('milestone-strip', '里程碑与结论', 'Milestones and decision', 'slideforge', [slot('timeline', 0, 0, 1, .62), p(0, .76, 1, .24)]),
    pattern('hero-caption', '主图与说明', 'Hero and caption', 'pptmaster', [im(0, 0, 1, .75), p(0, .84, 1, .16)]),
    pattern('editorial-photo', '编辑式图文', 'Editorial image', 'pptmaster', [p(0, 0, .25, .55), p(0, .65, .25, .35), im(.32, 0, .68, 1)]),
    pattern('photo-triptych', '三图叙事', 'Photo triptych', 'pptmaster', [im(0, 0, .3, .65), im(.35, 0, .3, .65), im(.7, 0, .3, .65), p(0, .75, .3, .25), p(.35, .75, .3, .25), p(.7, .75, .3, .25)]),
    pattern('photo-gallery', '四图目录', 'Four-photo gallery', 'pptmaster', [im(0, 0, .47, .37), p(0, .39, .47, .1), im(.53, 0, .47, .37), p(.53, .39, .47, .1), im(0, .54, .47, .34), p(0, .9, .47, .1), im(.53, .54, .47, .34), p(.53, .9, .47, .1)]),
    pattern('photo-kpi', '项目照片与指标', 'Photo and metrics', 'colliers', [im(0, 0, .65, 1), metric(.72, 0, .28, .26), metric(.72, .37, .28, .26), metric(.72, .74, .28, .26)]),
    pattern('photo-pair', '双图与结论', 'Two photos and conclusion', 'pptmaster', [im(0, 0, .47, .72), im(.53, 0, .47, .72), p(0, .82, 1, .18)]),
    pattern('gallery-commentary', '图集与分析', 'Gallery and commentary', 'colliers', [im(0, 0, .28, .45), im(.33, 0, .28, .45), im(0, .55, .28, .45), im(.33, .55, .28, .45), p(.68, 0, .32, 1)]),
    pattern('photo-table', '项目图片与参数', 'Project photo and parameters', 'colliers', [im(0, 0, .42, .46), p(.49, 0, .51, .46), table(0, .56, 1, .44)]),
    pattern('fact-and-context', '关键数字与背景', 'Fact and context', 'mck', [metric(0, .12, .32, .65), p(.42, 0, .58, 1)]),
    pattern('kpi-rail-chart', '指标侧栏与图表', 'Metric rail and chart', 'slideforge', [metric(0, 0, .23, .28), metric(0, .36, .23, .28), metric(0, .72, .23, .28), chart(.3, 0, .7, 1)]),
    pattern('kpi-chart-dashboard', '指标与趋势看板', 'KPI and trend dashboard', 'pptmaster', [metric(0, 0, .3, .23), metric(.35, 0, .3, .23), metric(.7, 0, .3, .23), chart(0, .32, 1, .68)]),
    pattern('scorecard-summary', '评分表与重点指标', 'Scorecard and key metric', 'mck', [table(0, 0, .68, 1), metric(.75, .05, .25, .35), p(.75, .55, .25, .45)]),
    pattern('metric-comparison', '双指标与解读', 'Two metrics and interpretation', 'mck', [metric(0, 0, .44, .3), metric(.56, 0, .44, .3), p(0, .47, .44, .53), p(.56, .47, .44, .53)]),
    pattern('metric-bridge', '指标关系与依据', 'Metric relationship and evidence', 'colliers', [metric(.01, .1, .27, .3), metric(.365, .1, .27, .3), metric(.72, .1, .27, .3), p(0, .67, 1, .33)], [mark('arrow', .3, .19, .045, .08), mark('arrow', .655, .19, .045, .08)]),
    pattern('dual-chart', '双图对照', 'Two-chart comparison', 'mck', [chart(0, 0, .47, 1), chart(.53, 0, .47, 1)]),
    pattern('chart-table', '趋势与数据明细', 'Trend and supporting table', 'colliers', [chart(0, 0, .58, 1), table(.65, 0, .35, 1)]),
    pattern('table-insight', '数据表与洞察', 'Table and insight', 'mck', [table(0, 0, .66, 1), p(.74, .04, .26, .92)], [mark('rect', .71, 0, .29, 1)]),
    pattern('chart-evidence', '图表与关键依据', 'Chart and evidence', 'pptmaster', [chart(0, 0, .67, 1), p(.74, 0, .26, .5), metric(.74, .64, .26, .36)]),
    pattern('chart-stack', '上下双图', 'Stacked chart panels', 'colliers', [chart(0, 0, 1, .46), chart(0, .54, 1, .46)]),
    pattern('chart-triptych', '三图分析', 'Three chart panels', 'mck', [chart(0, 0, .3, 1), chart(.35, 0, .3, 1), chart(.7, 0, .3, 1)]),
    pattern('table-conclusion', '数据明细与结论', 'Table and conclusion', 'pptmaster', [table(0, 0, 1, .7), p(0, .81, 1, .19)]),
    pattern('comparison-tables', '双表对比', 'Two-table comparison', 'colliers', [table(0, 0, .47, .78), table(.53, 0, .47, .78), p(0, .88, 1, .12)]),
    pattern('risk-register', '风险清单与应对', 'Risk register and response', 'colliers', [p(0, 0, .2, 1), table(.28, 0, .72, 1)]),
    pattern('leader-team', '负责人及协作团队', 'Leader and delivery team', 'colliers', [slot('team', 0, 0, .29, 1), slot('team', .38, 0, .62, 1)]),
    pattern('team-directory', '团队履历目录', 'Team directory', 'colliers', [slot('team', 0, 0, 1, 1)]),
    pattern('case-outcomes', '案例与成果指标', 'Case and outcomes', 'colliers', [slot('case', 0, 0, .66, 1), metric(.74, 0, .26, .32), metric(.74, .44, .26, .32)]),
    pattern('decision-next-steps', '决策与下一步', 'Decision and next steps', 'recipes', [p(0, 0, .39, 1), slot('timeline', .47, 0, .53, 1)], [mark('rect', .43, 0, .005, 1)]),
];
export const PATTERN_BY_ID: ReadonlyMap<string, LayoutPattern> = new Map(PATTERNS.map(p => [p.id, p]));
if (PATTERN_BY_ID.size !== PATTERNS.length)
    throw new Error('Duplicate layout pattern ID');
