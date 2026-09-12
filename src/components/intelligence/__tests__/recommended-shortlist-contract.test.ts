import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('Intelligence recommended shortlist contract', () => {
  it('routes Intelligence to the recommendation-first workspace', () => {
    const page = source('src/app/intelligence/page.tsx');
    expect(page).toContain('IntelligenceRecommendationWorkspace');
    expect(page).not.toContain('IntelligenceWorkspace');
  });

  it('makes direct recommendation and Broker review the primary workflow', () => {
    const workspace = source('src/components/intelligence/IntelligenceRecommendationWorkspace.tsx');
    expect(workspace).toContain("'开始推荐'");
    expect(workspace).toContain('AI 推荐候选');
    expect(workspace).toContain('核心推荐理由');
    expect(workspace).toContain('评分构成');
    expect(workspace).toContain("aiPreselected ? 'AI 预选' : '已确认'");
    expect(workspace).toContain('查看技术信息');
    expect(workspace).not.toContain('AI 推荐 shortlist');
    expect(workspace).toContain('方案候选 {selectedIds.length} / 5');
    expect(workspace).toContain('需求已修改');
    expect(workspace).not.toContain('AI 已理解客户需求');
    expect(workspace).not.toContain('确认条件并查看地图');
  });

  it('keeps the full recommendation universe on the authenticated server route', () => {
    const route = source('src/app/api/intelligence/recommend/route.ts');
    const loader = source('src/lib/intelligence/recommendationServer.ts');
    const workspace = source('src/components/intelligence/IntelligenceRecommendationWorkspace.tsx');
    expect(route).toContain('requireIntelligenceAccess');
    expect(route).toContain('loadRecommendationUniverse');
    expect(loader).toContain("from('buildings')");
    expect(loader).toContain("from('building_metrics')");
    expect(loader).toContain("from('building_brochure_data')");
    expect(workspace).toContain('recommendIntelligenceBuildings');
    expect(workspace).not.toContain('loadIntelligenceRecommendationUniverse');
  });

  it('keeps map and proposal as downstream review tools and seeds the Broker-selected shortlist', () => {
    const workspace = source('src/components/intelligence/IntelligenceRecommendationWorkspace.tsx');
    const draft = source('src/lib/intelligence/proposalDraft.ts');
    expect(workspace).toContain('在地图核验');
    expect(workspace).toContain("router.push('/intelligence/proposal')");
    expect(workspace).toContain('selectedBuildings.map');
    expect(draft).toContain('MAX_PROPOSAL_CANDIDATES = 5');
    expect(draft).toContain('evaluationCapabilities');
  });
});