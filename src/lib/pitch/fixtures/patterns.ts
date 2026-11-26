import type { SlideContent } from '../contracts/content';
import { PATTERN_BY_ID } from '../layout/patterns/catalog';
/** Isolated examples; never registered as formal enterprise facts. Every slot
 * receives real structured input and every preview uses the production engine. */
export function patternFixture(id: string, language: 'zh' | 'en', sourceId: string, mediaId: string): SlideContent | undefined {
    const pattern = PATTERN_BY_ID.get(id);
    if (!pattern)
        return undefined;
    const en = language === 'en', refs = { sourceIds: [sourceId] };
    return {
        protocol: 'colliers-pitch/1', locale: language, title: en ? pattern.en : pattern.zh,
        blocks: pattern.slots.map((s, i): SlideContent['blocks'][number] => {
            if (s.kind === 'paragraph')
                return { kind: 'paragraph', text: en ? `Example ${i + 1}` : `示例 ${i + 1}`, ...refs };
            if (s.kind === 'image')
                return { kind: 'image', mediaAssetId: mediaId, mediaVersion: 1, alt: en ? 'Synthetic space illustration' : '合成空间示意图', ...refs };
            if (s.kind === 'metric')
                return { kind: 'metric', label: en ? 'Sample' : '样本', value: i === 0 ? 0 : 120, unit: 'm²', ...refs };
            if (s.kind === 'table')
                return { kind: 'table', columns: en ? ['Item', 'Value'] : ['样本', '数值'], rows: [['A', 0], ['B', null]], ...refs };
            if (s.kind === 'chart')
                return { kind: 'chart', chartType: 'column', categories: ['Q1', 'Q2'], series: [{ name: en ? 'Test' : '测试', unit: 'm²', values: [0, 120] }], ...refs };
            if (s.kind === 'team')
                return { kind: 'team', members: [{ name: en ? 'Test Member' : '测试成员', title: en ? 'Test role' : '测试角色', biography: en ? 'Synthetic profile' : '合成档案', mediaAssetId: mediaId, mediaVersion: 1 }], ...refs };
            if (s.kind === 'case')
                return { kind: 'case', title: en ? 'Test case' : '测试案例', challenge: en ? 'Define scope' : '明确范围', approach: en ? 'Compare evidence' : '比较证据', outcome: en ? 'Test only' : '仅供测试', ...refs };
            return { kind: 'timeline', entries: [{ date: '2026-01-01', title: en ? 'Define' : '明确', description: en ? 'Test only' : '仅测试' }, { date: '2026-02-01', title: en ? 'Deliver' : '交付', description: en ? 'Test only' : '仅测试' }], ...refs };
        }),
        sources: [{ id: sourceId, kind: 'synthetic', label: en ? 'Synthetic example' : '合成示例', locator: `pattern:${id}`, version: '1', dataAsOf: '2026-01-01' }],
        dataAsOf: '2026-01-01', disclosure: 'internal', isTestData: true,
    };
}
