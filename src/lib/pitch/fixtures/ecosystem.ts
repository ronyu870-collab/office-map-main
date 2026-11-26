import { ECOSYSTEM_BY_ID } from '../templates/ecosystem';
import { patternFixture } from './patterns';
import { slideContentSchema, type SlideContent } from '../contracts/content';
/** Independently authored examples. All facts remain explicitly synthetic;
 * examples never acquire client-export or external-model permission. */
export function ecosystemFixture(id: string, language: 'zh' | 'en', sourceId: string, mediaId: string): SlideContent {
    const template = ECOSYSTEM_BY_ID.get(id);
    if (!template)
        throw new Error('PITCH_TEMPLATE_UNAVAILABLE');
    const content = patternFixture(template.patternId, language, sourceId, mediaId)!;
    content.title = template.names[language];
    const sample = (field: string) => /日期|时间|时点|节点/.test(field) ? '2026 年一季度' : /边界|限制|范围外|排除/.test(field) ? '仅覆盖约定服务范围' : /客群|行业/.test(field) ? '示例企业办公需求' : /目标|承诺/.test(field) ? '完成示例项目方案评估' : /依据|证据|原文/.test(field) ? '合成记录，需另行核验' : /事项|请求|决策|确认/.test(field) ? '确认示例方案及责任人' : /计划|安排|交付/.test(field) ? '先确认需求，再比较选项' : /风险|约束|障碍|问题/.test(field) ? '关键条件尚待确认' : /客群|行业/.test(field) ? '示例企业办公需求' : /现状|观察/.test(field) ? '示例项目处于评估阶段' : '示例项目 A 与方案 B';
    content.blocks = content.blocks.map((b, i) => {
        const label = language === 'zh' ? template.fields[i] : `${template.names.en} · ${i + 1}`;
        if (b.kind === 'paragraph')
            return { ...b, text: language === 'zh' ? `${label}\n${sample(template.fields[i])}` : `${label}\nIllustrative scope for Project A; subject to confirmation.` };
        if (b.kind === 'metric')
            return { ...b, label, value: /预算|成本|支出|费用/.test(template.fields[i]) ? 120000 : /空置率/.test(template.fields[i]) ? 8.5 : 120, unit: /面积|规模/.test(template.fields[i]) ? 'm²' : /空置率/.test(template.fields[i]) ? '%' : /租金/.test(template.fields[i]) ? 'RMB/m²/month' : /预算|成本|支出|费用/.test(template.fields[i]) ? 'RMB' : language === 'zh' ? '样本' : 'sample' };
        if (b.kind === 'chart')
            return { ...b, series: [{ ...b.series[0], name: language === 'zh' ? '示例' : 'Sample', unit: language === 'zh' ? '示例值' : 'sample', values: [100, 120] }] };
        if (b.kind === 'image')
            return { ...b, alt: `${label} · ${language === 'zh' ? '合成图示' : 'Synthetic illustration'}` };
        return b;
    });
    content.sources[0] = { ...content.sources[0], locator: `template-example:${template.id}`, version: String(template.version) };
    return slideContentSchema.parse(content);
}
